import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeHookService, claudeHookService } from './hook-service'
import { openClaudeHookService } from '../openclaude/hook-service'
import { codebuddyHookService } from '../codebuddy/hook-service'
import { qoderHookService, qoderCnHookService } from '../qoder/hook-service'
import { qwenCodeHookService } from '../qwen-code/hook-service'

let sandbox = ''
let foreignOrca = ''

beforeEach(() => {
  // Linux /tmp can have a separate per-user quota even with free tmpfs space.
  sandbox = mkdtempSync(
    join(process.platform === 'linux' ? '/var/tmp' : tmpdir(), 'ash-direct-claude-hooks-')
  )
  vi.stubEnv('HOME', sandbox)
  mkdirSync(join(sandbox, '.claude'), { recursive: true, mode: 0o700 })
  mkdirSync(join(sandbox, '.openclaude'), { recursive: true, mode: 0o700 })
  mkdirSync(join(sandbox, '.orca'), { mode: 0o700 })
  foreignOrca = join(sandbox, 'foreign-app-state.txt')
  writeFileSync(foreignOrca, 'Synthetic Orca state: never touch\n')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(sandbox, { recursive: true, force: true })
})

function expectForeignUnchanged(): void {
  expect(readdirSync(join(sandbox, '.claude'))).toEqual([])
  expect(readdirSync(join(sandbox, '.openclaude'))).toEqual([])
  expect(existsSync(join(sandbox, '.ash-ide', 'agent-hooks'))).toBe(false)
  expect(readdirSync(join(sandbox, '.orca'))).toEqual([])
  expect(readFileSync(foreignOrca, 'utf8')).toBe('Synthetic Orca state: never touch\n')
}

describe.skipIf(process.platform === 'win32')(
  'Claude/OpenClaude direct global hook methods fail closed without ownership',
  () => {
    it('also guards every other provider using the shared Claude-shaped hook service', () => {
      for (const service of [
        codebuddyHookService,
        qoderHookService,
        qoderCnHookService,
        qwenCodeHookService
      ]) {
        expect(service.install()).toMatchObject({
          state: 'skipped',
          skipReason: 'ash_ownership_unavailable'
        })
        expect(service.remove()).toMatchObject({
          state: 'skipped',
          skipReason: 'ash_ownership_unavailable'
        })
      }
      expectForeignUnchanged()
      for (const name of ['.codebuddy', '.qoder', '.qoder-cn', '.qwen']) {
        expect(existsSync(join(sandbox, name))).toBe(false)
      }
    })

    it('blocks direct Claude and OpenClaude installs before provider or script writes', () => {
      expect(claudeHookService.install({ claudeVersion: '2.1.0' })).toMatchObject({
        agent: 'claude',
        state: 'skipped',
        skipReason: 'ash_ownership_unavailable'
      })
      expect(openClaudeHookService.install()).toMatchObject({
        agent: 'openclaude',
        state: 'skipped',
        skipReason: 'ash_ownership_unavailable'
      })
      expectForeignUnchanged()
    })

    it('blocks a separate Claude profile setup worker service before creating profile hooks', () => {
      const profilePath = join(sandbox, '.claude', 'profiles', 'synthetic-worker')
      const separateService = new ClaudeHookService()
      expect(
        separateService.install({ configDir: profilePath, claudeVersion: '2.1.0' })
      ).toMatchObject({
        agent: 'claude',
        state: 'skipped',
        skipReason: 'ash_ownership_unavailable'
      })
      expect(existsSync(profilePath)).toBe(false)
      expectForeignUnchanged()
    })

    it('blocks direct Claude and OpenClaude removals before modifying foreign entries', () => {
      expect(claudeHookService.remove()).toMatchObject({
        agent: 'claude',
        state: 'skipped',
        skipReason: 'ash_ownership_unavailable'
      })
      expect(openClaudeHookService.remove()).toMatchObject({
        agent: 'openclaude',
        state: 'skipped',
        skipReason: 'ash_ownership_unavailable'
      })
      expectForeignUnchanged()
    })

    it('blocks direct shared script and agent-view refreshes without reading foreign configs', async () => {
      await expect(claudeHookService.refreshManagedScripts()).resolves.toBeUndefined()
      await expect(openClaudeHookService.refreshManagedScripts()).resolves.toBeUndefined()
      expectForeignUnchanged()
    })

    it('blocks direct remote hook installers before touching an SFTP client', async () => {
      const sftp = { readFile: vi.fn(), writeFile: vi.fn() } as never
      await expect(
        claudeHookService.installRemote(sftp, '/synthetic/remote-home')
      ).resolves.toMatchObject({
        agent: 'claude',
        state: 'skipped',
        skipReason: 'ash_ownership_unavailable'
      })
      await expect(
        openClaudeHookService.installRemote(sftp, '/synthetic/remote-home')
      ).resolves.toMatchObject({
        agent: 'openclaude',
        state: 'skipped',
        skipReason: 'ash_ownership_unavailable'
      })
      expectForeignUnchanged()
    })

    it('retains nonmutating provider hook status inspection', () => {
      expect(claudeHookService.getStatus()).toMatchObject({ agent: 'claude' })
      expect(openClaudeHookService.getStatus()).toMatchObject({ agent: 'openclaude' })
      expectForeignUnchanged()
    })
  }
)
