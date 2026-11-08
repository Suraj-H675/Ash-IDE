import { lstatSync } from 'node:fs'

/**
 * Native Claude tests send real subprocesses a synthetic API key and a loopback
 * base URL. Linux's system-managed Claude settings outrank process/session
 * settings and could redirect that API request to a real endpoint.
 *
 * Do not run the fixture at all if that policy boundary is present or cannot
 * be inspected. Other OS-managed policy mechanisms need separate isolation.
 * This guard is test-only; it is NOT a production provider-sandbox guarantee.
 */
export function assertClaudeNativeFixtureHasNoManagedLinuxPolicy(): void {
  if (process.platform !== 'linux') {
    throw new Error('native Claude fixture only supports Linux policy isolation')
  }
  if (lstatSync('/etc/claude-code', { throwIfNoEntry: false })) {
    throw new Error('native Claude fixture refuses to run with system-managed Claude settings')
  }
}
