import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type * as NodeOs from 'node:os'
import { join } from 'node:path'
import { setupCodexHookHomes } from './hook-service-test-harness'
import {
  computeCodexTrustKey,
  getExplicitHomeCodexHookSourcePath
} from '../../trust/identity/codex-trust-identity'
import { upsertHookTrustContent } from '../../trust/toml/config-toml-hook-trust-edit'
import { readHookTrustEntries } from '../../trust/toml/config-toml-trust'

const { homedirMock, getPathMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>(),
  getPathMock: vi.fn<(name: string) => string>()
}))

vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  homedir: homedirMock
}))
vi.mock('electron', () => ({ app: { getPath: getPathMock } }))

import { CodexHookService } from './codex-hook-service-implementation'
import {
  cleanupLegacyManagedHookRepresentations,
  cleanupLegacySystemManagedHooks
} from '../reconciliation/codex-hook-legacy-cleanup'
import { promoteCodexRuntimeHookApprovalsToSystem } from '../../trust/hooks/hook-trust-promotion'
import { reconcileRealHomeCodexHookEntries } from '../reconciliation/codex-real-home-hook-install'

const homes = setupCodexHookHomes(homedirMock, getPathMock)

function systemHome(): string {
  return join(homes.tmpHome, '.codex')
}

function managedHome(): string {
  return join(homes.userDataDir, 'codex-runtime-home', 'home')
}

function writeNativeUserHook(): void {
  mkdirSync(systemHome(), { recursive: true, mode: 0o700 })
  writeFileSync(
    join(systemHome(), 'hooks.json'),
    `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'foreign-user-hook' }] }] } })}\n`
  )
}

describe.skipIf(process.platform === 'win32')(
  'Codex launch must not silently rewrite native provider hooks',
  () => {
    it('blocks direct legacy cleanup of a retired Orca hook in native Codex config', async () => {
      mkdirSync(systemHome(), { recursive: true, mode: 0o700 })
      const nativeHooks = join(systemHome(), 'hooks.json')
      const oldScript = join(homes.tmpHome, '.orca', 'agent-hooks', 'codex-hook.sh')
      const oldCommand = `if [ -x '${oldScript}' ]; then /bin/sh '${oldScript}'; fi`
      const raw = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: oldCommand }] }] } })}\n`
      writeFileSync(nativeHooks, raw)
      await cleanupLegacySystemManagedHooks()
      await cleanupLegacyManagedHookRepresentations()
      expect(readFileSync(nativeHooks, 'utf8')).toBe(raw)
      expect(existsSync(managedHome())).toBe(false)
    })

    it('blocks native-launch real-home reconciliation without changing provider hooks', async () => {
      writeNativeUserHook()
      const nativeHooks = join(systemHome(), 'hooks.json')
      const before = readFileSync(nativeHooks, 'utf8')
      await reconcileRealHomeCodexHookEntries({
        hashes: null,
        isEnabled: () => true,
        convertOlderForms: false
      })
      expect(readFileSync(nativeHooks, 'utf8')).toBe(before)
      expect(existsSync(join(systemHome(), 'config.toml'))).toBe(false)
    })

    it.each(['install', 'refresh'] as const)(
      'preserves a legacy Orca profile block during %s of an Ash runtime home',
      async (operation) => {
        writeNativeUserHook()
        const legacyProfile = join(systemHome(), 'orca-agent-status.config.toml')
        const foreign = [
          'model = "user-selected"',
          '# BEGIN ORCA AGENT STATUS HOOKS',
          '[[hooks.Stop]]',
          'command = "codex-hook"',
          '# END ORCA AGENT STATUS HOOKS',
          ''
        ].join('\n')
        writeFileSync(legacyProfile, foreign)
        const previousHooks = readFileSync(join(systemHome(), 'hooks.json'), 'utf8')
        const service = new CodexHookService()
        const status =
          operation === 'install'
            ? await service.install()
            : await service.refreshRuntimeUserHooks()
        expect(status.agent).toBe('codex')
        expect(readFileSync(legacyProfile, 'utf8')).toBe(foreign)
        expect(readFileSync(join(systemHome(), 'hooks.json'), 'utf8')).toBe(previousHooks)
        expect(existsSync(join(managedHome(), 'hooks.json'))).toBe(true)
      }
    )

    it('does not promote an Ash runtime approval into native Codex config on repeated launch', async () => {
      writeNativeUserHook()
      const service = new CodexHookService()
      expect((await service.install()).state).toBe('installed')
      const runtimeTomlPath = join(managedHome(), 'config.toml')
      const entry = {
        sourcePath: getExplicitHomeCodexHookSourcePath(join(managedHome(), 'hooks.json')),
        eventLabel: 'stop' as const,
        groupIndex: 1,
        handlerIndex: 0,
        command: 'foreign-user-hook'
      }
      const toml = readFileSync(runtimeTomlPath, 'utf8')
      writeFileSync(
        runtimeTomlPath,
        upsertHookTrustContent(toml, [{ ...entry, trustedHash: 'sha256:synthetic-approval' }])
      )
      const nativeToml = join(systemHome(), 'config.toml')
      const before = existsSync(nativeToml) ? readFileSync(nativeToml, 'utf8') : null
      promoteCodexRuntimeHookApprovalsToSystem(managedHome())
      expect(existsSync(nativeToml) ? readFileSync(nativeToml, 'utf8') : null).toBe(before)
      await service.install()
      expect(existsSync(nativeToml) ? readFileSync(nativeToml, 'utf8') : null).toBe(before)
      // With native promotion disabled, mirrored approvals may require explicit
      // reapproval. Never silently write them into another application's trust.
      expect(readHookTrustEntries(runtimeTomlPath).has(computeCodexTrustKey(entry))).toBe(false)
    })
  }
)
