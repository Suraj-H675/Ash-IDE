import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/agent-launch/contracts/agent-launch-runtime-capability'
/** Preserve the direct handler's older folder-create constraint.
 * Live Ash mobile calls are denied earlier at RPC admission. */

import { AgentLaunchTargetForbiddenError } from '../../../../shared/agent-launch/contracts/agent-launch-target-forbidden'
import type { AgentLaunchTarget } from '../../../../shared/agent-launch/contracts/agent-launch-intent'
import type { RpcContext } from '../core'

export function assertAgentLaunchTargetAuthorized(
  target: Pick<AgentLaunchTarget, 'kind'>,
  context: Pick<RpcContext, 'clientKind'>
): void {
  // The retired phone routing table permitted worktree.create, but not
  // folderWorkspace.create. Preserve direct-handler compatibility while
  // denyRpcMethodForCaller rejects every mobile RPC before any handler runs.
  if (context.clientKind === 'mobile' && target.kind === 'create-folder-workspace') {
    throw new AgentLaunchTargetForbiddenError()
  }
}

/** agent.launch.v2 declares support for both outcomes. CLI/runtime-socket and SSH bridges have no clientKind/capabilities; the desktop renderer is a runtime client and must advertise support. */
export function supportsAgentLaunch(
  context: Pick<RpcContext, 'clientKind' | 'clientCapabilities'>
): boolean {
  return (
    context.clientKind === undefined ||
    context.clientCapabilities?.includes(AGENT_LAUNCH_RUNTIME_CAPABILITY) === true
  )
}
