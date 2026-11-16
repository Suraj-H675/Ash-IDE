import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash Main process excludes general app-plugin workspace and agent interception', () => {
  it('retains normal worktree and folder creation without app-plugin rewrites', () => {
    const paths = [
      'src/main/ipc/worktrees/create/register-worktree-create-handlers.ts',
      'src/main/runtime/workspaces/creation/workspace-creation.ts',
      'src/main/ipc/repos/folder-workspace-handlers.ts',
      'src/main/runtime/repositories/runtime-project-group-controller.ts'
    ]
    for (const path of paths) {
      expect(source(path), path).not.toMatch(
        /applyWorkspaceCreatePluginHook|createFolderWorkspaceWithPluginHooks|workspace-create-plugin-hook/
      )
    }
    const ipc = source(paths[0])
    expect(ipc).toContain('withProjectWorktreeCreate')
    expect(ipc).toContain('createLocalWorktree(')
    expect(ipc).toContain('releaseAutomationWorkspaceProvenanceRequest(')
    expect(source(paths[1])).toContain('resolveManagedWorktreeCreateStartup')
    expect(source(paths[2])).toContain("creatorProvenance: { kind: 'host' }")
    expect(source(paths[3])).toContain(
      "creatorProvenance: input.creatorProvenance ?? { kind: 'host' }"
    )
  })

  it('retains PTY preflight and launch admission without an excluded agent plugin hook', () => {
    for (const path of ['src/main/ipc/pty/ipc/spawn-run.ts', 'src/main/ipc/pty/runtime/spawn.ts']) {
      expect(source(path), path).not.toMatch(
        /applyAgentLaunchPluginHook|spawn-agent-launch-plugin-hook/
      )
      expect(source(path)).toContain('runPtySpawn(')
    }
    expect(source('src/main/ipc/pty/ipc/spawn-run.ts')).toContain(
      'preparePtyIpcSpawnPreflight(ctx)'
    )
    expect(source('src/main/ipc/pty/runtime/spawn.ts')).toContain('prepareRuntimePtySpawn(ctx)')
    for (const path of [
      'src/main/ipc/pty/spawn-agent-launch-plugin-hook.ts',
      'src/main/plugins/hooks/workspace-create-plugin-hook.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
    }
  })

  it('does not create or shut down nonexistent general app-plugin services at Main lifecycle', () => {
    for (const path of [
      'src/main/startup/main-process-state.ts',
      'src/main/startup/main-process-quit.ts',
      'src/main/startup/main-process-pty-startup.ts'
    ]) {
      expect(source(path), path).not.toMatch(
        /pluginService|pluginKillListService|pluginInstallStatsService|pluginMarketplaceService|pluginMarketplaceInstaller|pluginAutoUpdater|pluginUpdateReviewNotices|pluginHostShutdown|emitPluginWorktreeLifecycle|notifyWorkspaceCreatedPluginHook/
      )
    }
    const quit = source('src/main/startup/main-process-quit.ts')
    expect(quit).toContain("{ name: 'daemon', promise: daemonTeardown }")
    expect(quit).toContain("{ name: 'runtime-rpc', promise: rpcStopAndClear }")
    expect(quit).toContain('stopStructuredAgentSessionRuntime()')
    expect(source('src/main/startup/main-process-pty-startup.ts')).toContain(
      'handleCodexHomePtySpawned'
    )
  })
})
