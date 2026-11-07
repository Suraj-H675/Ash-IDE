import { execFileSync } from 'node:child_process'

// Pin official skill installs to the full build commit so installed and bundled skills agree on every channel.
export function resolveBuildSourceCommit() {
  let commit = ''
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  } catch (error) {
    if (process.env.ASH_ALLOW_UNCOMMITTED_BUILD === '1') {
      return '0'.repeat(40)
    }
    throw new Error(
      `Could not read the source commit with \`git rev-parse HEAD\`: ${
        error instanceof Error ? error.message : String(error)
      }. Ash builds must run from a Git checkout so bundled source references can pin to it.`
    )
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`\`git rev-parse HEAD\` returned "${commit}", not a full commit hash.`)
  }
  return commit
}
