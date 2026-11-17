import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { BUNDLED_SKILL_SOURCES } from './bundled-skill-sources'

const pluginAuthoringDigest = '633d9b8dd17a7406a77541633e10391d95dfe10a0c25fcd0e04d6a248ea2f597'
const currentManifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'resources/skills/current-manifest.json'), 'utf8')
)
const releasedDigests = JSON.parse(
  readFileSync(resolve(process.cwd(), 'resources/skills/released-digests.json'), 'utf8')
)

describe('bundled plugin-authoring skill retirement', () => {
  it('excludes the skill from current bundled install sources and manifest', () => {
    expect(BUNDLED_SKILL_SOURCES.some(({ name }) => name === 'orca-plugin-authoring')).toBe(false)
    expect(
      currentManifest.skills.some(({ name }: { name: string }) => name === 'orca-plugin-authoring')
    ).toBe(false)
  })

  it('retains the previously released digest for existing user installs', () => {
    expect(releasedDigests.skills['orca-plugin-authoring']).toEqual([pluginAuthoringDigest])
  })
})
