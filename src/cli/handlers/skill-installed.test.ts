import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'
import type { HandlerContext } from '../dispatch'
import { SKILL_DISCOVERY_HANDLERS } from './skill-installed'

const successMeta = { runtimeId: 'runtime-1' }

function context(
  call: RuntimeClient['call'],
  options: { isRemote?: boolean; json?: boolean } = {}
): HandlerContext {
  const client = new RuntimeClient('/tmp/ash-skill-discovery-test', 60_000, null, null)
  vi.spyOn(client, 'call').mockImplementation(call)
  vi.spyOn(client, 'isRemote', 'get').mockReturnValue(options.isRemote ?? false)
  return { client, cwd: '/repo', flags: new Map(), json: options.json ?? false }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('provider-native installed skills CLI', () => {
  it('lists safe discovered skill selectors without leaking local paths', async () => {
    const call = vi.fn().mockResolvedValue({
      id: 'request-1',
      ok: true,
      result: {
        skills: [
          {
            id: 'skill-id',
            name: 'alpha',
            description: 'Alpha skill',
            providers: ['codex'],
            sourceKind: 'home',
            sourceLabel: 'Codex',
            rootPath: '/secret/root',
            directoryPath: '/secret/root/alpha',
            skillFilePath: '/secret/root/alpha/SKILL.md',
            installed: true,
            updatedAt: null
          }
        ],
        sources: [],
        scannedAt: 1
      },
      _meta: successMeta
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await SKILL_DISCOVERY_HANDLERS['skills installed']!(context(call, { json: true }))

    expect(call).toHaveBeenCalledWith('skills.discover', { cwd: '/repo' })
    const output = String(log.mock.calls[0][0])
    expect(output).toContain('skill-id')
    expect(output).not.toContain('/secret/root')
  })

  it.each([
    ['a forwarded shell', false, '/remote/repo'],
    ['a paired runtime', true, undefined]
  ])(
    'rejects %s without accessing foreign skill folders',
    async (_label, isRemote, forwardedCwd) => {
      if (forwardedCwd) {
        vi.stubEnv('ORCA_CLI_CWD', forwardedCwd)
      }
      const call = vi.fn()
      await expect(
        SKILL_DISCOVERY_HANDLERS['skills installed']!(context(call, { isRemote }))
      ).rejects.toMatchObject({ code: 'invalid_environment' })
      expect(call).not.toHaveBeenCalled()
    }
  )

  it('has no publishing command alongside native skill discovery', () => {
    expect(Object.keys(SKILL_DISCOVERY_HANDLERS)).toEqual(['skills installed'])
  })
})
