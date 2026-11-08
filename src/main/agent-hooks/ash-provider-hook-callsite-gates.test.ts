import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

describe('Ash global provider hook call-site gates before an ownership ledger exists', () => {
  it('does not schedule global hook installs or refresh on headless startup', () => {
    const headless = source('src/main/orcad/orcad-managed-agent-hooks.ts')
    expect(headless).not.toMatch(/\bstartCodexHooks\s*\(/)
    expect(headless).not.toMatch(/\breconcileStartupManagedAgentHooks\s*\(/)
    expect(headless).not.toMatch(/\brefreshInstalledOpenCodeStatusPlugins\s*\(/)
    expect(headless).not.toMatch(/\bagentView\.reconcile\s*\(/)
  })

  it('does not reconcile provider-global Claude plugin bindings on account or settings updates', () => {
    for (const filename of [
      'src/main/providers/accounts/provider-account-services.ts',
      'src/main/ipc/settings.ts',
      'src/main/runtime/client/settings/runtime-client-settings.ts'
    ]) {
      expect(source(filename), filename).not.toMatch(/getClaudeAgentViewService\s*\(/)
      expect(source(filename), filename).not.toMatch(/\bagentView\.reconcile\s*\(/)
    }
  })

  it('provisions separate Claude account homes without installing global hooks or view plugins', () => {
    const router = source('src/main/claude-accounts/claude-profile-router.ts')
    expect(router).toContain('hooks: false')
    expect(router).not.toMatch(/\bprepareProfile\s*\(/)
    expect(router).not.toMatch(/\bprobeRecentClaudeCliVersion\s*\(/)
  })
})
