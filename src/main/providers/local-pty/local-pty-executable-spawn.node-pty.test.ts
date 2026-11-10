import * as nodePty from 'node-pty'
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { spawnPtyExecutable, spawnShellWithFallback } from './local-pty-executable-spawn'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe.skipIf(process.platform !== 'linux')('node-pty local shell fallback observation', () => {
  it('observes the fallback shell environment after fallback-only env mutations', async () => {
    const initialConfigDir = '/synthetic/primary-claude-home'
    const fallbackConfigDir = '/synthetic/fallback-claude-home'
    const observations: {
      phase: 'before' | 'after'
      attempt: 'primary' | 'fallback'
      configDirSha256: string | null
    }[] = []
    let nativeSpawnCalls = 0
    let nativeFallbackConfigDirSha256: string | null = null
    let spawned: ReturnType<typeof spawnShellWithFallback> | null = null
    try {
      const result = spawnShellWithFallback({
        shellPath: '/bin/sh',
        shellArgs: ['-c', 'exit 91'],
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: { CLAUDE_CONFIG_DIR: initialConfigDir, PATH: process.env.PATH ?? '/usr/bin:/bin' },
        ptySpawn: (file, args, options) => {
          nativeSpawnCalls += 1
          if (nativeSpawnCalls === 1) {
            throw new Error('synthetic primary spawn rejection')
          }
          nativeFallbackConfigDirSha256 = options.env?.CLAUDE_CONFIG_DIR
            ? hash(options.env.CLAUDE_CONFIG_DIR)
            : null
          return nodePty.spawn(file, args, options)
        },
        getShellReadyConfig: () => ({
          args: ['-c', 'exec /bin/sleep 30'],
          env: { CLAUDE_CONFIG_DIR: fallbackConfigDir }
        }),
        onNativeShellSpawnPhase: ({ phase, attempt, env }) => {
          observations.push({
            phase,
            attempt,
            configDirSha256: env.CLAUDE_CONFIG_DIR ? hash(env.CLAUDE_CONFIG_DIR) : null
          })
        }
      })
      spawned = result

      expect(nativeSpawnCalls).toBeGreaterThan(1)
      expect(observations).toEqual([
        { phase: 'before', attempt: 'primary', configDirSha256: hash(initialConfigDir) },
        { phase: 'before', attempt: 'fallback', configDirSha256: hash(fallbackConfigDir) },
        { phase: 'after', attempt: 'fallback', configDirSha256: hash(fallbackConfigDir) }
      ])
      expect(result.shellPath).not.toBe('/bin/sh')
      expect(result.process.pid).toBeGreaterThan(0)
      expect(nativeFallbackConfigDirSha256).toBe(hash(fallbackConfigDir))
    } finally {
      if (spawned) {
        const exited = new Promise<void>((resolve) => {
          spawned?.process.onExit(() => resolve())
        })
        spawned.process.kill('SIGKILL')
        await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
      }
    }
  })
})

describe('native shell-entry observation isolation', () => {
  it('checks the exact native environment immediately before node-pty dispatch', () => {
    const env = {
      CLAUDE_CONFIG_DIR: '/disposable/managed-home',
      ORCA_CLAUDE_PROFILE_POINTER: '/disposable/private-pin'
    }
    const events: string[] = []
    const proc = spawnPtyExecutable({
      file: '/bin/sh',
      args: ['-c', 'exit 0'],
      cols: 80,
      rows: 24,
      cwd: '/disposable',
      env,
      assertNativeSpawnEnvironment: (nativeEnv) => {
        events.push('assert')
        expect(nativeEnv).toBe(env)
      },
      onNativeSpawnAttempt: () => events.push('attempt'),
      ptySpawn: (_file, _args, options) => {
        events.push('spawn')
        expect(options.env).toBe(env)
        return { pid: 84 } as never
      }
    })

    expect(proc.pid).toBe(84)
    expect(events).toEqual(['assert', 'attempt', 'spawn'])

    const failedEvents: string[] = []
    expect(() =>
      spawnPtyExecutable({
        file: '/bin/sh',
        args: ['-c', 'exit 0'],
        cols: 80,
        rows: 24,
        cwd: '/disposable',
        env,
        assertNativeSpawnEnvironment: () => failedEvents.push('assert'),
        onNativeSpawnAttempt: () => failedEvents.push('attempt'),
        onNativeSpawnCallFailure: () => failedEvents.push('failure'),
        ptySpawn: () => {
          failedEvents.push('spawn')
          throw new Error('ambiguous native failure')
        }
      })
    ).toThrow('ambiguous native failure')
    expect(failedEvents).toEqual(['assert', 'attempt', 'spawn', 'failure'])
  })

  it('passes only a frozen allowlisted copy; mutation and a thrown observer never change native env', () => {
    const nativeEnv = {
      CLAUDE_CONFIG_DIR: '/disposable/managed-home',
      ORCA_CLAUDE_PROFILE_POINTER: '/disposable/pointer',
      ANTHROPIC_API_KEY: 'test-only-never-disclose',
      ORCA_AGENT_LAUNCH_TOKEN: 'test-only-launch-token',
      HOME: '/disposable/home'
    }
    const nativeSpawn = vi.fn(
      (_file: string, _args: string[], options: { env: Record<string, string> }) => {
        expect(options.env).toBe(nativeEnv)
        expect(options.env.CLAUDE_CONFIG_DIR).toBe('/disposable/managed-home')
        expect(options.env.ANTHROPIC_API_KEY).toBe('test-only-never-disclose')
        return { pid: 82 }
      }
    )
    const phases: string[] = []
    const proc = spawnPtyExecutable({
      file: '/bin/sh',
      args: ['-l'],
      cols: 80,
      rows: 24,
      cwd: '/disposable',
      env: nativeEnv,
      ptySpawn: nativeSpawn as never,
      onNativeShellSpawnPhase: ({ phase, env }) => {
        phases.push(phase)
        expect(Object.isFrozen(env)).toBe(true)
        expect(Object.keys(env).sort()).toEqual([
          'CLAUDE_CONFIG_DIR',
          'ORCA_CLAUDE_PROFILE_POINTER'
        ])
        expect(JSON.stringify(env)).not.toContain('test-only-never-disclose')
        expect(JSON.stringify(env)).not.toContain('test-only-launch-token')
        expect(() => {
          ;(env as Record<string, string>).CLAUDE_CONFIG_DIR = '/other/home'
        }).toThrow()
        throw new Error('observer failure must not alter spawn')
      }
    })
    expect(proc.pid).toBe(82)
    expect(nativeSpawn).toHaveBeenCalledTimes(1)
    expect(phases).toEqual(['before', 'after'])
    expect(nativeEnv.CLAUDE_CONFIG_DIR).toBe('/disposable/managed-home')
  })

  it('handles asynchronous observer rejection without affecting native spawn', async () => {
    const nativeEnv = { CLAUDE_CONFIG_DIR: '/disposable/home', ANTHROPIC_API_KEY: 'secret' }
    const nativeSpawn = vi.fn(() => ({ pid: 83 }))
    const onNativeShellSpawnPhase = vi.fn(
      async ({ env }: { env: Readonly<Record<string, string>> }) => {
        expect(Object.isFrozen(env)).toBe(true)
        await Promise.resolve()
        expect(() => {
          ;(env as Record<string, string>).CLAUDE_CONFIG_DIR = '/other/home'
        }).toThrow()
        throw new Error('async observation rejection')
      }
    )
    const proc = spawnPtyExecutable({
      file: '/bin/sh',
      args: [],
      cols: 80,
      rows: 24,
      cwd: '/disposable',
      env: nativeEnv,
      ptySpawn: nativeSpawn as never,
      onNativeShellSpawnPhase
    })
    expect(proc.pid).toBe(83)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(onNativeShellSpawnPhase).toHaveBeenCalledTimes(2)
    expect(nativeEnv.CLAUDE_CONFIG_DIR).toBe('/disposable/home')
    expect(nativeSpawn).toHaveBeenCalledTimes(1)
  })
})
