import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { HANDLER_GROUPS } from './handler-group-manifest'
import { cliErrorExitCode } from './cli-exit-code'
import { ignoresRemoteSelection } from './remote-selection-scope'
import { ASH_COMMAND_SPECS, COMMAND_SPECS } from './specs'
import { BUNDLED_SKILL_GUIDES } from './bundled-skill-guides'
import { CLI_COMMAND_NAMES } from '../main/startup/cli-command-names'
import { reportCliError } from './cli-error'
import { formatCommandScopedFlagHelp } from './command-scoped-flag-help'

const ABSENT_PLUGIN_AUTHORING_PATHS = [
  'src/cli/plugin-authoring',
  'src/cli/plugin-dev-watch',
  'src/cli/plugin-handler-groups.ts',
  'src/cli/specs/plugin.ts',
  'src/cli/specs/plugin-view.ts',
  'src/cli/specs/plugin-dev-request.ts',
  'src/cli/handlers/plugin-authoring.ts',
  'src/cli/handlers/plugin-dev-emit.ts',
  'src/cli/handlers/plugin-dev-request.ts',
  'src/cli/handlers/plugin-runtime.ts',
  'src/cli/handlers/plugin-dev-watch.ts',
  'src/cli/handlers/plugin-dev-watch.test.ts',
  'src/cli/handlers/plugin-shot-chrome.ts',
  'src/cli/handlers/plugin-shot-chrome.test.ts',
  'src/cli/handlers/plugin-shot-default-dir.ts',
  'src/cli/handlers/plugin-shot-default-dir.test.ts',
  'src/cli/handlers/plugin-shot-editor.ts',
  'src/cli/handlers/plugin-shot-editor.test.ts',
  'src/cli/handlers/plugin-shot-scenario.ts',
  'src/cli/handlers/plugin-shot-scenario.test.ts',
  'src/cli/handlers/plugin-view.ts',
  'src/cli/handlers/plugin-view.test.ts',
  'src/cli/runtime/terminal-prompt-mutation-recovery-plugin-denied.test.ts',
  'config/scripts/plugin-authoring',
  'config/scripts/skills/bundle-generation/generate-plugin-authoring-skill-references.mjs'
]

describe('Ash native CLI excludes voice and general IDE plugin commands', () => {
  it('does not expose speech or app-plugin command specifications', () => {
    for (const registry of [ASH_COMMAND_SPECS, COMMAND_SPECS]) {
      expect(registry.some((spec) => spec.path[0] === 'speech')).toBe(false)
      expect(registry.some((spec) => spec.path[0] === 'plugin')).toBe(false)
      expect(registry.some((spec) => spec.path.join(' ') === 'terminal create')).toBe(true)
    }
  })

  it('does not load excluded handler groups and does not treat commands as startup routes', () => {
    expect(
      HANDLER_GROUPS.filter(
        ({ name, keys }) =>
          /^(?:speech|plugin)(?:-| |$)/.test(name) ||
          keys.some((key) => /^(?:speech|plugin)(?: |$)/.test(key))
      )
    ).toEqual([])
    expect(CLI_COMMAND_NAMES).not.toContain('plugin')
    expect(CLI_COMMAND_NAMES).not.toContain('speech')
    expect(CLI_COMMAND_NAMES).toContain('terminal')
  })

  it('keeps ordinary CLI error and remote-selection behavior', () => {
    expect(cliErrorExitCode()).toBe(1)
    expect(ignoresRemoteSelection(['account', 'list'])).toBe(true)
    expect(ignoresRemoteSelection(['terminal', 'send'])).toBe(false)
  })

  it('removes app-plugin authoring and dev-watch source trees', () => {
    for (const path of ABSENT_PLUGIN_AUTHORING_PATHS) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
    }
  })

  it('removes stale app-plugin help and streaming error formatting', () => {
    expect(formatCommandScopedFlagHelp('plugin create', 'template')).toBeUndefined()
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    let logged: unknown
    try {
      reportCliError(new Error('retired command'), true, {
        commandPath: ['plugin', 'dev', 'watch']
      })
      logged = output.mock.calls[0]?.[0]
    } finally {
      output.mockRestore()
    }
    expect(logged).toContain('\n')
  })

  it('keeps app-plugin authoring guidance out of the bundled CLI skill', () => {
    expect(BUNDLED_SKILL_GUIDES.some(({ name }) => String(name) === 'orca-plugin-authoring')).toBe(
      false
    )
    const orcaCli = BUNDLED_SKILL_GUIDES.find(({ name }) => name === 'orca-cli')
    expect(orcaCli).toBeDefined()
    expect(orcaCli?.references.map(({ name }) => name)).not.toContain('plugins')
    expect(orcaCli?.markdown).not.toMatch(/^## Plugins$/m)
    expect(orcaCli?.markdown).not.toContain('references/plugins.md')
    expect(orcaCli?.markdown).not.toContain('orca-plugin-authoring')
  })
})
