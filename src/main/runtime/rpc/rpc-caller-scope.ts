/** Transport stamps proven scope; unstamped calls are local desktop/owner CLI. Non-owner methods require an explicitly granted permission. */
import type { RpcMethodPermission, RuntimeDeviceGrant } from './rpc-method-permission'

export type { RuntimeDeviceGrant }

export type RpcCallerScope =
  | { kind: 'owner' }
  /** Delegated phones inherit at most their paired desktop's scope, which never includes pairing-admin. */
  | { kind: 'mobile'; delegated?: boolean }
  | { kind: 'runtime-paired'; grants: readonly RuntimeDeviceGrant[] }

export const OWNER_RPC_CALLER_SCOPE: RpcCallerScope = { kind: 'owner' }

// Remote UI needs settings/accounts/skills/SSH/updates; workspace already runs host-user commands (rpc-method-permission.ts).
// Desktop control requires pairing-time grant; pairing admin is never granted.
const RUNTIME_PAIRED_STANDARD: ReadonlySet<RpcMethodPermission> = new Set([
  'workspace',
  'settings-write',
  'accounts-admin',
  'skills-admin',
  'host-admin',
  'device-self'
])

/** Historical mobile identities are always denied, including probes for unknown methods.
 * Kept at dispatcher admission as a second boundary behind WebSocket authentication. */
export function denyRpcMethodForCaller(
  scope: RpcCallerScope,
  methodName: string,
  permission: RpcMethodPermission | undefined
): string | null {
  if (scope.kind === 'mobile') {
    return 'Mobile clients are not supported by Ash IDE'
  }
  if (scope.kind === 'owner' || permission === undefined) {
    return null
  }
  return !RUNTIME_PAIRED_STANDARD.has(permission) &&
    !scope.grants.some((grant) => grant === permission)
    ? `Method '${methodName}' needs the '${permission}' permission, which this paired client was not granted when it paired.`
    : null
}
