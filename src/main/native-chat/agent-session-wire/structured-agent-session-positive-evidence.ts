import { getStructuredAgentSessionHost } from './structured-agent-session-registry'

/**
 * Positive in-process evidence only. The registry is not a host-wide provider
 * census: a missing host/status and an empty result cannot prove no child runs.
 * No session IDs, prompts or provider credentials leave this function.
 */
export function observedHostedStructuredAgentChildren(): number {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return 0
  }
  const loaded = host.loadedSessionIds()
  let observed = 0
  for (const id of loaded) {
    if (host.readStatusSummary(id)?.hostExecutionOwned === true) {
      observed += 1
    }
  }
  return observed
}
