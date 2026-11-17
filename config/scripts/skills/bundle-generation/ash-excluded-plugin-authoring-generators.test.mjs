import { describe, expect, it } from 'vitest'

import {
  CANONICAL_GUIDE_NAMES,
  GUIDE_ALIASES,
  STUB_TOPICS
} from './generate-bundled-skill-guides.mjs'
import { EXCLUDED_BUNDLED_SKILL_NAMES } from './generate-skill-bundle-manifest.mjs'

describe('plugin-authoring skill generation exclusions', () => {
  it('does not discover or generate an authoring guide', () => {
    expect(CANONICAL_GUIDE_NAMES).not.toContain('orca-plugin-authoring')
    expect(GUIDE_ALIASES).not.toHaveProperty('orca-plugin-authoring')
    expect(STUB_TOPICS).not.toContain('orca-plugin-authoring')
    expect(EXCLUDED_BUNDLED_SKILL_NAMES.has('orca-plugin-authoring')).toBe(true)
  })
})
