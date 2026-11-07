const ASH_UNAVAILABLE_CAPABILITY_PREFIXES = [
  'accounts.',
  'artifacts.',
  'automation.',
  'automations.',
  'cloud.',
  'device.',
  'device-key.',
  'browser.desktopBridge.',
  'emulator.',
  'github.',
  'gitlab.',
  'hostedReview.',
  'jira.',
  'linear.',
  'managed-runtime.',
  'managedRuntime.',
  'managedServer.',
  'mobile.',
  'mobileRelay.',
  'mobileWeb.',
  'notifications.desktop-presence.',
  'notifications.remote-',
  'network.browserTunnel.',
  'orcad.',
  'orchestration.federation.',
  'orchestration.federation-',
  'orchestration.federation',
  'pairing.',
  'plugin.',
  'plugins.',
  'runtime.automatic-work.',
  'runtime.environments.',
  'runtime.status.compat.',
  'project-host-setup.',
  'remote-server.',
  'relay.',
  'skills.',
  'speech.',
  'ssh.',
  'task-source.',
  'telemetry.',
  'updater.',
  'remote-runtime.'
] as const

export function isAshRuntimeCapability(capability: string): boolean {
  return !ASH_UNAVAILABLE_CAPABILITY_PREFIXES.some((prefix) => capability.startsWith(prefix))
}

export function ashRuntimeCapabilities<T extends string>(capabilities: readonly T[]): T[] {
  return capabilities.filter(isAshRuntimeCapability)
}
