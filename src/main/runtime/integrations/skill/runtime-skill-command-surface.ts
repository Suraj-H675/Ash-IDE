import { RuntimeSkillInstallQueries } from './runtime-skill-install-queries'

// Native skill discovery/provider roots and bundled local skill maintenance remain
// inherited from the install-query implementation. The deprecated Orca Cloud
// publisher/owned-share API is intentionally absent from the live runtime surface.
export class RuntimeSkillCommands extends RuntimeSkillInstallQueries {}
