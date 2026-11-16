import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getManagedScript } from '../claude/hook-script'
import { AgentHookServer } from './server'
import { buildBody, postHookEvent } from './server.test-fixtures'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash retains provider-native hooks without general app-plugin tool decisions', () => {
  it('records accepted provider status and responds without a plugin tool decision handler', () => {
    const server = source('src/main/agent-hooks/server/server-lifecycle.ts')
    expect(server).not.toContain('respondAfterAgentToolPluginHooks')
    expect(server).not.toContain('toolCallOwner')
    expect(server).toContain('this.recordCurrentAuthorityObservation(event)')
    expect(server).toContain('this.applyObservedLocalHook(event, normalized.onAccepted)')
    expect(server).toContain('this.checkHookOwner(source, aliasedBody)')
    expect(server).toContain('res.writeHead(204)')
    expect(server).toContain('this.transportInterference.record')

    const service = source('src/main/claude/hook-service.ts')
    expect(service).not.toContain('decidesPreToolUse')
    expect(service).toContain('skipWhenDevinImportsClaude')
    expect(service).toContain('skipWhenGrokImportsClaude')
    expect(service).toContain('skipWhenCursorImportsClaude')
  })

  it('keeps ordinary POSIX hook posts and provider permissions, but no removed decision header', () => {
    // A stale compatibility caller must not resurrect app-plugin tool decisions.
    const legacyOptions = { source: 'claude' as const, decidesPreToolUse: true }
    const script = getManagedScript('posix', legacyOptions)
    expect(script).toContain('printf "{}\\n"')
    expect(script).toContain('spool_hook_event')
    expect(script).toContain('ORCA_AGENT_HOOK_TOKEN')
    expect(script).not.toMatch(
      /orca_hook_(?:decides|answer|reply|finish)|X-Orca-Hook-Decision|claude-pre-tool-use-v1/
    )
    expect(source('src/main/agent-hooks/hook-post-command.ts')).not.toContain('decisionHeaderVar')
    for (const file of [
      'src/main/agent-hooks/agent-tool-plugin-hooks.ts',
      'src/main/claude/claude-hook-decision-script.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(false)
    }
  })

  it('continues to acknowledge authenticated provider tool events through the real hook listener', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ash-native-tool-status-'))
    const server = new AgentHookServer()
    try {
      await server.start({ env: 'production', userDataPath: directory })
      const response = await postHookEvent(
        server,
        buildBody(
          {
            hook_event_name: 'PreToolUse',
            tool_name: 'Bash',
            tool_input: { command: 'printf ok' }
          },
          { hookEventName: 'PreToolUse' }
        )
      )
      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
    } finally {
      server.stop()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')(
    'never accepts a forged plugin permission decision from a POSIX hook POST',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'ash-tool-decision-'))
      const calls = join(directory, 'curl-calls')
      const fakeCurl = join(directory, 'curl')
      try {
        writeFileSync(
          fakeCurl,
          [
            '#!/bin/sh',
            'printf "called\\n" >> "$ASH_TEST_CURL_CALLS"',
            'printf \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"}}\'',
            ''
          ].join('\n')
        )
        chmodSync(fakeCurl, 0o700)
        const legacyOptions = { source: 'claude' as const, decidesPreToolUse: true }
        const script = getManagedScript('posix', legacyOptions)
        const run = spawnSync('/bin/sh', ['-c', script], {
          encoding: 'utf8',
          input: JSON.stringify({
            hook_event_name: 'PreToolUse',
            tool_name: 'Bash',
            tool_input: { command: 'printf ok' }
          }),
          timeout: 8_000,
          env: {
            ...process.env,
            PATH: directory + delimiter + process.env.PATH,
            ASH_TEST_CURL_CALLS: calls,
            ORCA_PANE_KEY: 'test-pane',
            ORCA_AGENT_HOOK_PORT: '43210',
            ORCA_AGENT_HOOK_TOKEN: 'test-token'
          }
        })
        expect(run.error).toBeUndefined()
        expect(run.status, run.stderr).toBe(0)
        expect(existsSync(calls)).toBe(true)
        expect(run.stdout).toBe('{}\n')
        expect(run.stdout).not.toMatch(/permissionDecision|hookSpecificOutput/)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )
})
