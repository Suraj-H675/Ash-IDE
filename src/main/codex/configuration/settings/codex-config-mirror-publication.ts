import { writeFileAtomicallyIfUnchanged } from '../../../codex-accounts/fs-utils'

/** Publish an observed managed config without overwriting another Codex process's edits. */
export function publishManagedCodexConfigIfUnchanged(
  runtimeConfigPath: string,
  observedConfig: string | null,
  nextConfig: string
): void {
  if (
    !writeFileAtomicallyIfUnchanged(runtimeConfigPath, observedConfig, nextConfig, { mode: 0o600 })
  ) {
    throw new Error('Managed Codex config changed during mirror publication')
  }
}
