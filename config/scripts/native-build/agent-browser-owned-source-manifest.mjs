import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const scriptDirectory = import.meta.dirname
export const manifestPath = join(scriptDirectory, 'agent-browser-owned-v0.39.4.provenance.json')
export const patchPath = join(scriptDirectory, 'agent-browser-owned-v0.39.4.patch')
export const patchLicensePath = join(scriptDirectory, 'agent-browser-owned-LICENSE.txt')
export const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
