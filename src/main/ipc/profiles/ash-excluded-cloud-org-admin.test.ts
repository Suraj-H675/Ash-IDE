import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCAL_ORCA_PROFILE_ID } from '../../../shared/orca-profiles'
import { createWebOrcaProfilesApi } from '../../../renderer/src/web/preload-api/web-orca-profiles-api'

const excludedOrgModules = [
  'src/main/ipc/profiles/orca-profile-org-members-handlers.ts',
  'src/main/orca-profiles/profile-cloud-org-members-service.ts',
  'src/main/orca-profiles/profile-cloud-org-members-client.ts',
  'src/main/orca-profiles/profile-cloud-dev-org-members.ts'
] as const

const excludedOrgMethods = [
  'orgMembersList',
  'orgMemberInvite',
  'orgInviteRevoke',
  'orgMemberChangeRole',
  'orgMemberRemove'
] as const

describe('Ash excludes Orca cloud organization administration', () => {
  it('does not ship organization-member mutations or register cloud organization IPC', () => {
    for (const file of excludedOrgModules) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(false)
    }
    const profileHandlers = readFileSync(
      resolve(process.cwd(), 'src/main/ipc/profiles/orca-profiles.ts'),
      'utf8'
    )
    expect(profileHandlers).not.toContain('registerOrcaProfileOrgMemberHandlers')
    for (const method of excludedOrgMethods) {
      expect(profileHandlers).not.toContain(`orcaProfiles:${method}`)
    }
    expect(profileHandlers).toContain("ipcMain.handle('orcaProfiles:list'")
    expect(profileHandlers).toContain("'orcaProfiles:createLocal'")
    expect(profileHandlers).toContain("'orcaProfiles:transferProject'")
  })

  it('does not expose deprecated organization administration in desktop or web preload APIs', () => {
    const paths = [
      'src/preload/api/orca-profile-api.ts',
      'src/preload/api/orca-profiles-bridge.ts',
      'src/renderer/src/web/preload-api/web-orca-profiles-api.ts'
    ]
    for (const path of paths) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      for (const method of excludedOrgMethods) {
        expect(source, `${path}:${method}`).not.toContain(method)
      }
    }
  })

  it('preserves local profile listing, creation, switching and transfer fallback', async () => {
    const webProfiles = createWebOrcaProfilesApi().orcaProfiles
    expect(webProfiles).toBeDefined()
    if (!webProfiles) {
      throw new Error('Local profile API missing')
    }
    for (const method of excludedOrgMethods) {
      expect(method in webProfiles, method).toBe(false)
    }
    expect(await webProfiles.list()).toMatchObject({
      activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
      profiles: [{ id: DEFAULT_LOCAL_ORCA_PROFILE_ID, kind: 'local' }]
    })
    expect(await webProfiles.createLocal()).toMatchObject({
      activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
      profile: { id: DEFAULT_LOCAL_ORCA_PROFILE_ID, kind: 'local' }
    })
    expect(await webProfiles.switchProfile({ profileId: DEFAULT_LOCAL_ORCA_PROFILE_ID })).toEqual({
      status: 'already-active'
    })
    expect(typeof webProfiles.transferProject).toBe('function')
  })
})
