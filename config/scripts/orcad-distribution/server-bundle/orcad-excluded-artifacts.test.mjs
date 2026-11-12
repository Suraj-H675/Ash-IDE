import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ORCAD_ARTIFACTS,
  orcadArtifactFilenames,
  orcadTemplateCommonFilenames
} from '../../../../src/shared/orcad-artifacts.ts'
import { verifyPackagedOrcadTemplate } from '../template/verify-packaged-orcad-template.cjs'
import { writeOrcadTemplateTestFixture } from '../template/orcad-template-test-fixture.mjs'

describe('Ash server bundle exclusions', () => {
  it('never packages the excluded Linear SDK or mobile pairing web app', () => {
    const inventories = [
      ORCAD_ARTIFACTS.map((artifact) => artifact.filename),
      orcadArtifactFilenames('linux-x64-glibc'),
      orcadArtifactFilenames('win32-x64'),
      orcadTemplateCommonFilenames()
    ]

    for (const inventory of inventories) {
      expect(inventory.some((file) => file.startsWith('node_modules/@linear/'))).toBe(false)
      expect(inventory.some((file) => file.startsWith('out/mobile-web/'))).toBe(false)
    }
  })

  it('rejects excluded files when verifying a real server-template inventory', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ash-orcad-exclusions-'))
    try {
      const templateDir = await writeOrcadTemplateTestFixture(fixtureRoot)
      expect(() => verifyPackagedOrcadTemplate(fixtureRoot)).not.toThrow()

      for (const excluded of [
        'node_modules/@linear/sdk/index.js',
        'out/mobile-web/manifest.json'
      ]) {
        const unexpected = join(templateDir, ...excluded.split('/'))
        mkdirSync(dirname(unexpected), { recursive: true })
        writeFileSync(unexpected, 'excluded payload')
        expect(() => verifyPackagedOrcadTemplate(fixtureRoot)).toThrow(/inventory mismatch/)
        rmSync(unexpected)
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
