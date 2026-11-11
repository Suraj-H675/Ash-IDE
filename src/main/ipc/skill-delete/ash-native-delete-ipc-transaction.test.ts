import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  SkillDeletePlan,
  SkillDeleteRequest,
  SkillDeleteResult
} from '../../../shared/skill-delete-contract'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  trustedSender: { id: 29 },
  userDataPath: ''
}))

vi.mock('electron', () => ({
  app: { getPath: (key: string) => (key === 'userData' ? ipc.userDataPath : '') },
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      ipc.handlers.set(channel, listener)
    }
  }
}))
vi.mock('../ui', () => ({ getTrustedUIRendererWebContents: () => ipc.trustedSender }))

import { registerSkillDeleteIpcHandlers } from './handlers'
import { registerProviderNativeSkillDiscoveryHandler } from '../skills'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../../shared/skills'

let root = ''
let home = ''

function invoke<T>(channel: string, request?: unknown): Promise<T> {
  const handler = ipc.handlers.get(channel)
  if (!handler) {
    throw new Error(`Desktop startup did not register ${channel}`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test-owned IPC handlers are registered with the matching typed channel contracts; assertions below verify the returned shape.
  return Promise.resolve(handler({ sender: ipc.trustedSender }, request)) as Promise<T>
}

function makeSkill(name: string): string {
  const directory = join(home, '.agents', 'skills', name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Temporary integration-test skill\n---\n\n# ${name}\n`
  )
  return directory
}

function deleteRequest(skill: DiscoveredSkill): SkillDeleteRequest {
  return {
    operationId: randomUUID(),
    skills: [
      {
        id: skill.id,
        name: skill.name,
        directoryPath: skill.directoryPath,
        skillFilePath: skill.skillFilePath,
        updatedAt: skill.updatedAt
      }
    ]
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ash-native-skill-delete-'))
  home = join(root, 'isolated-home')
  mkdirSync(home, { recursive: true })
  vi.stubEnv('HOME', home)
  ipc.userDataPath = join(root, 'ash-profile')
  ipc.handlers.clear()
  const store = { getRepos: () => [] }
  const runtime = { resolveSkillDiscoveryProviderRoots: async () => ({}) }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the registration path reads only getRepos and resolveSkillDiscoveryProviderRoots from these test-owned fixtures.
  registerProviderNativeSkillDiscoveryHandler(store as never, runtime as never)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the delete registrar uses only the same two fixture methods; persisted user data is redirected to an isolated temp root.
  registerSkillDeleteIpcHandlers(store as never, runtime as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
  ipc.handlers.clear()
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('previews and deletes a discovered local skill through trusted desktop IPC, leaving its sibling intact', async () => {
  const removedDirectory = makeSkill('ash-delete-fixture')
  const preservedDirectory = makeSkill('ash-preserve-fixture')
  const discovery = await invoke<SkillDiscoveryResult>('skills:discover', { refresh: true })
  const skill = discovery.skills.find((entry) => entry.name === 'ash-delete-fixture')
  if (!skill) {
    throw new Error('Native provider skill fixture was not discovered')
  }
  const request = deleteRequest(skill)
  const preview = await invoke<SkillDeletePlan>('skills:previewDelete', request)
  expect(preview.operationId).toBe(request.operationId)
  expect(preview.skills).toHaveLength(1)
  expect(preview.skills[0]?.blocked).toBeUndefined()
  expect(preview.skills[0]?.placements).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: removedDirectory, kind: 'canonical' })])
  )
  expect(existsSync(removedDirectory)).toBe(true)

  const deleted = await invoke<SkillDeleteResult>('skills:delete', request)
  expect(deleted.skills).toEqual([
    expect.objectContaining({ name: 'ash-delete-fixture', status: 'deleted' })
  ])
  expect(existsSync(removedDirectory)).toBe(false)
  expect(existsSync(join(preservedDirectory, 'SKILL.md'))).toBe(true)

  const after = await invoke<SkillDiscoveryResult>('skills:discover', { refresh: true })
  expect(after.skills.some((entry) => entry.name === 'ash-delete-fixture')).toBe(false)
  expect(after.skills.some((entry) => entry.name === 'ash-preserve-fixture')).toBe(true)
})

it('rejects untrusted renderers and malformed delete requests before any filesystem mutation', async () => {
  const directory = makeSkill('ash-guard-fixture')
  const discovered = await invoke<SkillDiscoveryResult>('skills:discover', { refresh: true })
  const skill = discovered.skills.find((entry) => entry.name === 'ash-guard-fixture')
  if (!skill) {
    throw new Error('Guard fixture was not discovered')
  }
  const request = deleteRequest(skill)
  for (const channel of ['skills:previewDelete', 'skills:delete']) {
    expect(() => ipc.handlers.get(channel)?.({ sender: { id: 30 } }, request)).toThrow(
      'Unauthorized skill IPC sender'
    )
    await expect(invoke(channel, { ...request, injectedRoot: root })).rejects.toThrow()
  }
  expect(existsSync(join(directory, 'SKILL.md'))).toBe(true)
})

it('blocks stale skill metadata and never deletes an unowned sibling path', async () => {
  makeSkill('ash-stale-fixture')
  const discovered = await invoke<SkillDiscoveryResult>('skills:discover', { refresh: true })
  const skill = discovered.skills.find((entry) => entry.name === 'ash-stale-fixture')
  if (!skill) {
    throw new Error('Stale fixture was not discovered')
  }
  const staleRequest = deleteRequest(skill)
  const timestamp = (statSync(skill.skillFilePath).mtimeMs + 20_000) / 1000
  utimesSync(skill.skillFilePath, timestamp, timestamp)
  const stalePlan = await invoke<SkillDeletePlan>('skills:previewDelete', staleRequest)
  expect(stalePlan.skills[0]?.blocked).toBe('stale')
  const staleResult = await invoke<SkillDeleteResult>('skills:delete', staleRequest)
  expect(staleResult.skills[0]).toMatchObject({ status: 'skipped', blocked: 'stale' })
  expect(existsSync(skill.skillFilePath)).toBe(true)

  const unowned = join(root, 'outside-provider-roots', 'not-owned')
  mkdirSync(unowned, { recursive: true })
  const unownedFile = join(unowned, 'SKILL.md')
  writeFileSync(unownedFile, '# Not owned\n')
  const externalRequest: SkillDeleteRequest = {
    operationId: randomUUID(),
    skills: [
      {
        id: 'external-fixture',
        name: 'not-owned',
        directoryPath: unowned,
        skillFilePath: unownedFile,
        updatedAt: statSync(unownedFile).mtimeMs
      }
    ]
  }
  const external = await invoke<SkillDeleteResult>('skills:delete', externalRequest)
  expect(external.skills[0]).toMatchObject({ status: 'skipped', blocked: 'unowned' })
  expect(existsSync(unownedFile)).toBe(true)
})
