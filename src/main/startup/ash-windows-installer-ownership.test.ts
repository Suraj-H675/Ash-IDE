import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('Ash Windows co-installation and uninstall ownership (static packaging contract)', () => {
  it('packages Ash-only NSIS hooks rather than the inherited Orca uninstaller', () => {
    const builder = source('config/electron-builder.config.cjs')
    expect(builder).toContain("include: resolve(__dirname, 'nsis', 'ash-installer-hooks.nsh')")
    expect(builder).not.toContain("include: resolve(__dirname, 'nsis', 'orca-installer-hooks.nsh')")
  })

  it('does not run inherited Orca provider-hook or WSL cleanup preflights at Ash boot', () => {
    const main = source('src/main/index.ts')
    expect(main).not.toContain('runAgentHooksUninstallPreflight')
    expect(main).not.toContain('runWslHolderUninstallPreflight')
  })

  it('never removes provider-global Grok hooks during ordinary Ash GUI shutdown', () => {
    const quit = source('src/main/startup/main-process-quit.ts')
    expect(quit).not.toContain('removeManagedAgentHooksAsync')
    expect(quit).not.toContain('grokHookCleanup')
  })

  it('registers and unregisters only Ash document associations, and preserves all app data', () => {
    const nsis = source('config/nsis/ash-installer-hooks.nsh')
    expect(nsis).toContain('!macro customInstall')
    expect(nsis).toContain('!macro customUnInstall')
    expect(nsis).toContain('AshIDE.Markdown')
    expect(nsis).toContain('AshIDE.Tabular')
    expect(nsis).toContain('ASH_REMOVE_USER_PATH_ENTRY')
    expect(nsis).toContain('"$INSTDIR\\resources\\bin"')
    // Source attribution comments may name Orca; executable cleanup must not.
    expect(nsis).not.toMatch(/--orca|taskkill|RMDir\s*\/r|Delete\s+"\$APPDATA/i)
    expect(nsis).not.toContain('APPDATA\\Orca')
    expect(nsis).not.toContain('LOCALAPPDATA\\Orca')
    expect(nsis).not.toMatch(/nsExec::Exec|ExecWait|SetShellVarContext|DeleteRegKey\s+HKCU/i)
    const registryKeysRemoved = nsis.match(/^\s*DeleteRegKey SHELL_CONTEXT .+$/gm) ?? []
    expect(registryKeysRemoved).toHaveLength(2)
    expect(registryKeysRemoved.every((line) => /\$\{ASH_(MARKDOWN|TABULAR)_PROGID\}/.test(line))).toBe(true)
  })

  it('only removes the exact Ash CLI directory from PATH, without deleting other entries', () => {
    const nsis = source('config/nsis/ash-user-path-cleanup.nsh')
    expect(nsis).toContain('!macro ASH_REMOVE_USER_PATH_ENTRY DIR')
    expect(nsis).toContain('StrCpy $R9 "${DIR}"')
    expect(nsis).toContain('ReadRegStr $R0 HKCU "Environment" "Path"')
    expect(nsis).not.toMatch(/--orca|taskkill|RMDir\s*\/r/i)
  })
})
