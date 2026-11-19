import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listRecipeCatalog, listRecipes, resolveRecipeForRepo } from './ephemeral-vm-recipe-context'
import { mapDispatcherError } from '../runtime/rpc/dispatcher-error-response'
import { InvalidArgumentError } from '../runtime/rpc/core'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash Main excludes orphaned application-plugin hooks and recipe providers', () => {
  it('does not bind a plugin worker hook runner to the runtime or expose editor save-hook IPC', () => {
    expect(existsSync(resolve(process.cwd(), 'src/main/plugins/plugin-runtime-binding.ts'))).toBe(
      false
    )
    expect(existsSync(resolve(process.cwd(), 'src/main/ipc/plugins.ts'))).toBe(false)
    const hooks = source('src/main/agent-hooks/server/server-lifecycle.ts')
    expect(hooks).toContain('this.checkHookOwner(source, aliasedBody)')
    expect(hooks).toContain('this.applyObservedLocalHook(event, normalized.onAccepted)')
    const preload = source('src/preload/index.ts')
    expect(preload).not.toMatch(/plugins:\s*pluginsApi/)
  })

  it('removes orphan hook participants, tool-call parsing, editor-save hooks and plugin recipe provider', () => {
    for (const path of [
      'src/main/plugins/hooks/plugin-hook-participants.ts',
      'src/main/agent-hooks/agent-tool-call-reader.ts',
      'src/main/ipc/plugin-editor-save-hook-ipc.ts',
      'src/main/plugins/plugin-approved-vm-recipes.ts',
      'src/main/plugins/hooks/plugin-hook-dispatch.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
    }
    const vm = source('src/main/ipc/ephemeral-vm.ts')
    expect(vm).not.toMatch(/PluginService|getApprovedPluginVmRecipes|pluginRecipes/)
    expect(vm).toContain('registerEphemeralVmRuntimeHandlers(store)')
    expect(vm).toContain('listRecipes(store, args.repoId)')
    expect(vm).toContain('listRecipeCatalog(store)')
    const context = source('src/main/ipc/ephemeral-vm-recipe-context.ts')
    expect(context).not.toMatch(/combineEphemeralVmRecipes|pluginRecipes/)
    expect(context).toContain('loadHooks(repo.path)')
    expect(source('src/main/runtime/rpc/dispatcher-error-response.ts')).not.toMatch(
      /PluginHookDeniedError|plugin-hook-dispatch/
    )
  })

  it('preserves ordinary RPC error mapping without depending on a deleted plugin denial class', () => {
    const request = { id: 'ash-req', authToken: 'local', method: 'runtime.status' }
    const meta = { runtimeId: 'local-1' }
    expect(mapDispatcherError(request, meta, new InvalidArgumentError('Bad argument'))).toEqual({
      id: 'ash-req',
      ok: false,
      _meta: meta,
      error: { code: 'invalid_argument', message: 'Bad argument' }
    })
    expect(mapDispatcherError(request, meta, new Error('terminal_not_writable'))).toEqual({
      id: 'ash-req',
      ok: false,
      _meta: meta,
      error: { code: 'terminal_not_writable', message: 'terminal_not_writable' }
    })
  })

  it('keeps real repository-owned YAML recipes, catalog entries and diagnostics', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ash-local-recipe-'))
    const store = {
      getRepo: (repoId: string) => (repoId === 'repo-local' ? repo : undefined),
      getRepos: () => [repo]
    }
    const repo = {
      id: 'repo-local',
      path: directory,
      displayName: 'Original local checkout',
      badgeColor: 'blue',
      addedAt: Date.now()
    }
    try {
      writeFileSync(
        join(directory, 'orca.yaml'),
        [
          'environmentRecipes:',
          '  - id: local-recipe',
          '    name: Local recipe',
          '    create: ./local-start.sh',
          '    destroy: ./local-stop.sh'
        ].join('\n')
      )
      const recipes = listRecipes(store as never, 'repo-local')
      expect(recipes.status).toBe('ok')
      expect(recipes.repoPath).toBe(directory)
      expect(recipes.recipes).toEqual([
        expect.objectContaining({ id: 'local-recipe', create: './local-start.sh' })
      ])
      expect(recipes.diagnostics).toEqual([])
      expect(listRecipeCatalog(store as never)).toEqual([
        expect.objectContaining({
          repoId: 'repo-local',
          repoPath: directory,
          recipes: recipes.recipes,
          diagnostics: []
        })
      ])
      expect(resolveRecipeForRepo(directory, 'local-recipe')).toEqual(recipes.recipes[0])
      expect(resolveRecipeForRepo(directory, 'plugin-only')).toBeNull()
      expect(listRecipes(store as never, 'missing').status).toBe('error')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
