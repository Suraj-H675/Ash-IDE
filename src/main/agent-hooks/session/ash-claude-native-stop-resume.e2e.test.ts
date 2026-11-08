import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAshClaudeSessionSettings,
  claudeVerifiedArgsWithAshSessionSettings,
  verifyAshClaudeSessionSettings,
  type AshClaudeSessionSettings
} from './ash-claude-session-settings'
import { assertClaudeNativeFixtureHasNoManagedLinuxPolicy } from './ash-claude-native-test-host-guard'

/**
 * Explicitly opt-in with ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY=/absolute/path/to/claude.
 * Executes an already-installed *real* Claude binary with a fake key, fresh
 * isolated HOME/provider profile, and a loopback-only synthetic Messages API.
 * No real credentials or provider requests; no Ash production hook writes.
 */
const nativeBinary = process.env.ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY?.trim()
const maxTurnMs = 16_000

type HookEvent = {
  label: string
  event: string
  source?: string
  sessionId?: string
}

let root = ''
let profile = ''
let ashUserData = ''
let eventLog = ''
let settingsFile = ''
let mockServer: Server | undefined
let messages = 0

function writeHook(label: string): string {
  const path = join(root, `native hook '${label}'.js`)
  writeFileSync(
    path,
    [
      '#!/usr/bin/env node',
      "const {appendFileSync,readFileSync}=require('node:fs')",
      "const input=JSON.parse(readFileSync(0,'utf8'))",
      `appendFileSync(process.env.ASH_NATIVE_HOOK_LOG,JSON.stringify({label:${JSON.stringify(label)},event:input.hook_event_name,source:input.source,sessionId:input.session_id})+'\\n')`,
      ''
    ].join('\n'),
    { mode: 0o700 }
  )
  chmodSync(path, 0o700)
  return path
}

function hookForFile(scriptPath: string): object[] {
  const quoted = `'${scriptPath.replaceAll("'", "'\\''")}'`
  return [{ hooks: [{ type: 'command', command: quoted, timeout: 3 }] }]
}

function hookEvents(): HookEvent[] {
  const raw = readFileSync(eventLog, 'utf8').trim()
  return raw ? raw.split('\n').map((line) => JSON.parse(line) as HookEvent) : []
}

function eventLabels(events: HookEvent[]): string[] {
  return events.map((entry) => `${entry.label}:${entry.event}`).sort()
}

function writeSse(response: ServerResponse, model: string): void {
  const frame = (name: string, value: object): string =>
    `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': 'req_ash_synthetic_only'
  })
  const message = {
    id: `msg_${randomUUID().replaceAll('-', '')}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 25,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    }
  }
  response.write(frame('message_start', { type: 'message_start', message }))
  response.write(
    frame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' }
    })
  )
  response.write(
    frame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'OK' }
    })
  )
  response.write(frame('content_block_stop', { type: 'content_block_stop', index: 0 }))
  response.write(
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 }
    })
  )
  response.end(frame('message_stop', { type: 'message_stop' }))
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ash-claude-stop-resume-'))
  profile = join(root, 'foreign-claude')
  ashUserData = join(root, 'ash-private')
  eventLog = join(root, 'events.jsonl')
  settingsFile = join(profile, 'settings.json')
  messages = 0
  for (const path of [
    profile,
    ashUserData,
    join(root, 'home'),
    join(root, 'cache'),
    join(root, 'cwd')
  ]) {
    mkdirSync(path, { mode: 0o700 })
  }
  writeFileSync(eventLog, '', { mode: 0o600 })
  writeFileSync(
    settingsFile,
    `${JSON.stringify({
      hooks: {
        SessionStart: hookForFile(writeHook('FOREIGN')),
        Stop: hookForFile(writeHook('FOREIGN_STOP'))
      }
    })}\n`,
    { mode: 0o600 }
  )
  mockServer = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.startsWith('/v1/messages')) {
      response.writeHead(404)
      response.end()
      return
    }
    try {
      const chunks: Buffer[] = []
      let byteCount = 0
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk)
        byteCount += buffer.length
        if (byteCount > 2_000_000) {
          response.writeHead(413)
          response.end()
          return
        }
        chunks.push(buffer)
      }
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        response.writeHead(400)
        response.end()
        return
      }
      if (
        !body ||
        typeof body !== 'object' ||
        !('stream' in body) ||
        body.stream !== true ||
        !('model' in body) ||
        typeof body.model !== 'string'
      ) {
        response.writeHead(400)
        response.end()
        return
      }
      messages++
      writeSse(response, body.model)
    } catch {
      // A timed-out/terminated CLI can abort its request during fixture teardown.
      // Do not leak an unhandled rejection from Node's async server callback.
      response.destroy()
    }
  })
  await new Promise<void>((resolve, reject) => {
    mockServer?.once('error', reject)
    mockServer?.listen(0, '127.0.0.1', resolve)
  })
})

afterEach(async () => {
  if (mockServer) {
    mockServer.closeAllConnections()
    await new Promise<void>((resolve) => mockServer?.close(() => resolve()))
    mockServer = undefined
  }
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

function isolatedEnv(): NodeJS.ProcessEnv {
  const address = mockServer?.address()
  if (!address || typeof address === 'string') {
    throw new Error('mock Messages API must listen on loopback')
  }
  return {
    PATH: '/usr/bin:/bin',
    HOME: join(root, 'home'),
    CLAUDE_CONFIG_DIR: profile,
    XDG_CONFIG_HOME: profile,
    XDG_CACHE_HOME: join(root, 'cache'),
    ASH_NATIVE_HOOK_LOG: eventLog,
    ANTHROPIC_API_KEY: 'ash-synthetic-local-only-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    LANG: 'C.UTF-8'
  }
}

async function runNativeTurn(args: string[]): Promise<{ stdout: string; hooks: HookEvent[] }> {
  assertClaudeNativeFixtureHasNoManagedLinuxPolicy()
  if (!nativeBinary || !isAbsolute(nativeBinary)) {
    throw new Error('ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY must be an absolute executable path')
  }
  const env = isolatedEnv()
  const version = spawnSync(nativeBinary, ['--version'], {
    cwd: join(root, 'cwd'),
    env,
    encoding: 'utf8',
    timeout: 5000
  })
  expect(version.status).toBe(0)
  expect(version.stdout).toMatch(/Claude Code/)

  const child = spawn(
    nativeBinary,
    [...args, '--print', '--max-turns', '1', '--model', 'claude-sonnet-4-5', 'Say OK.'],
    { cwd: join(root, 'cwd'), env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout = (stdout + chunk.toString()).slice(-1200)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-1200)
  })
  let deadline: ReturnType<typeof setTimeout> | undefined
  const waitForExit = (timeoutMs: number): Promise<boolean> => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      const completed = () => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        child.off('exit', completed)
        resolve(false)
      }, timeoutMs)
      child.once('exit', completed)
    })
  }
  try {
    const result = await Promise.race([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => resolve({ code, signal }))
      }),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('native synthetic turn timed out')), maxTurnMs)
      })
    ])
    expect({ ...result, stderr }).toMatchObject({ code: 0, signal: null })
    expect(stdout.trim()).toBe('OK')
    return { stdout, hooks: hookEvents() }
  } finally {
    if (deadline) {
      clearTimeout(deadline)
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      if (!(await waitForExit(1500))) {
        child.kill('SIGKILL')
        expect(await waitForExit(1500), 'native Claude fixture child must exit after SIGKILL').toBe(
          true
        )
      }
    }
  }
}

async function overlayFor(sessionId: string): Promise<AshClaudeSessionSettings> {
  return createAshClaudeSessionSettings({
    ashUserData,
    sessionId,
    hooks: [
      { event: 'SessionStart', scriptPath: writeHook('ASH'), timeoutSeconds: 3 },
      { event: 'Stop', scriptPath: writeHook('ASH_STOP'), timeoutSeconds: 3 }
    ]
  })
}

const BOTH_EVENTS = [
  'ASH:SessionStart',
  'ASH_STOP:Stop',
  'FOREIGN:SessionStart',
  'FOREIGN_STOP:Stop'
]

// Opt-in: CI runners are not provisioned with a native Claude Code executable.
describe.skipIf(process.platform !== 'linux' || !nativeBinary)(
  'native Claude completed Stop hooks and session resume with private overlay',
  () => {
    it('runs foreign and Ash hooks at both ends of a completed synthetic turn', async () => {
      const foreignBefore = readFileSync(settingsFile, 'utf8')
      const overlay = await overlayFor(randomUUID())
      const result = await runNativeTurn(
        await claudeVerifiedArgsWithAshSessionSettings(ashUserData, overlay.sessionId, [
          '--session-id',
          overlay.sessionId
        ])
      )
      expect(eventLabels(result.hooks)).toEqual(BOTH_EVENTS)
      expect(result.hooks.every((entry) => entry.sessionId === overlay.sessionId)).toBe(true)
      expect(messages).toBe(1)
      expect(readFileSync(settingsFile, 'utf8')).toBe(foreignBefore)
      await verifyAshClaudeSessionSettings(ashUserData, overlay)
    }, 25_000)

    it('reapplies both hook sources on explicit resume with the same session overlay', async () => {
      const foreignBefore = readFileSync(settingsFile, 'utf8')
      const overlay = await overlayFor(randomUUID())
      const first = await runNativeTurn(
        await claudeVerifiedArgsWithAshSessionSettings(ashUserData, overlay.sessionId, [
          '--session-id',
          overlay.sessionId
        ])
      )
      expect(eventLabels(first.hooks)).toEqual(BOTH_EVENTS)
      const resumed = await runNativeTurn(
        await claudeVerifiedArgsWithAshSessionSettings(ashUserData, overlay.sessionId, [
          '--resume',
          overlay.sessionId
        ])
      )
      expect(eventLabels(resumed.hooks.slice(first.hooks.length))).toEqual(BOTH_EVENTS)
      expect(resumed.hooks.length).toBe(first.hooks.length + BOTH_EVENTS.length)
      expect(resumed.hooks.every((entry) => entry.sessionId === overlay.sessionId)).toBe(true)
      expect(
        resumed.hooks
          .slice(first.hooks.length)
          .filter((entry) => entry.event === 'SessionStart')
          .map((entry) => entry.source)
      ).toEqual(['resume', 'resume'])
      expect(messages).toBe(2)
      expect(readFileSync(settingsFile, 'utf8')).toBe(foreignBefore)
      await verifyAshClaudeSessionSettings(ashUserData, overlay)
    }, 45_000)

    it('does not assume Ash overlay survives resume when --settings is omitted', async () => {
      const foreignBefore = readFileSync(settingsFile, 'utf8')
      const overlay = await overlayFor(randomUUID())
      const first = await runNativeTurn(
        await claudeVerifiedArgsWithAshSessionSettings(ashUserData, overlay.sessionId, [
          '--session-id',
          overlay.sessionId
        ])
      )
      expect(eventLabels(first.hooks)).toEqual(BOTH_EVENTS)
      const resumed = await runNativeTurn(['--resume', overlay.sessionId])
      const resumeEvents = resumed.hooks.slice(first.hooks.length)
      expect(eventLabels(resumeEvents)).toEqual(['FOREIGN:SessionStart', 'FOREIGN_STOP:Stop'])
      expect(resumed.hooks.length).toBe(first.hooks.length + 2)
      expect(resumeEvents.every((entry) => entry.sessionId === overlay.sessionId)).toBe(true)
      expect(messages).toBe(2)
      expect(readFileSync(settingsFile, 'utf8')).toBe(foreignBefore)
      await verifyAshClaudeSessionSettings(ashUserData, overlay)
    }, 45_000)
  }
)
