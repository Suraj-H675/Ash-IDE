import {
  abandonAshClaudeHookInstall,
  AshHookOwnershipConflict,
  confirmAshClaudeHookInstall,
  planAshClaudeHookRemoval,
  type AshHookOwnershipClaim
} from './ash-hook-ownership-plan'
import { readAshHookOwnershipLedger } from './ash-hook-ownership-store'
import { readAshClaudeSettingsSnapshot } from './ash-provider-json-guard'
import { validateAshProviderTarget } from './ash-provider-path-policy'

export type AshClaudeHookClaimAudit = {
  id: string
  event: string
  state: 'verified' | 'pending' | 'published_unconfirmed' | 'conflict'
  /** Only Ash's claim identity and generic diagnostics are exposed, never hook commands. */
  detail: string
}

/**
 * Diagnostic inspection only. This does not grant authority to install, remove,
 * repair or promote provider-global hook entries. The approved provider path
 * must come from the caller's selected Claude home, never from ledger contents.
 */
export async function auditAshClaudeHookOwnership(args: {
  ashUserData: string
  approvedConfigPath: string
}): Promise<{ ledgerRevision: string | null; claims: AshClaudeHookClaimAudit[] }> {
  validateAshProviderTarget(args.approvedConfigPath)
  const snapshot = await readAshHookOwnershipLedger(args.ashUserData)
  const matching = snapshot.ledger.claims.filter(
    (claim) => claim.configPath === args.approvedConfigPath
  )
  // No claims means no provider-home reads at all. A forged or stale claim
  // must never cause us to open an arbitrary file from its stored path.
  let providerConfig: Record<string, unknown> | null = null
  let providerReadable = true
  if (matching.length > 0) {
    try {
      providerConfig = (await readAshClaudeSettingsSnapshot(args.approvedConfigPath))?.config ?? {}
    } catch {
      providerReadable = false
    }
  }
  return {
    ledgerRevision: snapshot.revision,
    claims: snapshot.ledger.claims.map((claim) => {
      if (claim.configPath !== args.approvedConfigPath) {
        return entry(claim, 'conflict', 'Claim belongs to a different provider configuration')
      }
      if (!providerReadable || providerConfig === null) {
        return entry(claim, 'conflict', 'Provider configuration cannot be verified safely')
      }
      try {
        if (claim.state === 'installed') {
          // The existing pure planner confirms the exact UUID marker, event,
          // complete definition hash and uniqueness across events.
          planAshClaudeHookRemoval({
            ledger: snapshot.ledger,
            config: providerConfig,
            configPath: args.approvedConfigPath,
            id: claim.id
          })
          return entry(claim, 'verified', 'Exact Ash-owned hook entry matches its claim')
        }
        try {
          confirmAshClaudeHookInstall({
            ledger: snapshot.ledger,
            config: providerConfig,
            configPath: args.approvedConfigPath,
            id: claim.id
          })
          return entry(
            claim,
            'published_unconfirmed',
            'Provider entry exists, but the durable Ash claim is still prepared'
          )
        } catch (error) {
          if (!(error instanceof AshHookOwnershipConflict)) {
            throw error
          }
          abandonAshClaudeHookInstall({
            ledger: snapshot.ledger,
            config: providerConfig,
            configPath: args.approvedConfigPath,
            id: claim.id
          })
          return entry(claim, 'pending', 'Prepared claim has not been published')
        }
      } catch (error) {
        // Expose no provider data and never auto-repair a divergent entry.
        return entry(
          claim,
          'conflict',
          error instanceof AshHookOwnershipConflict
            ? 'Provider entry is missing, modified or ambiguous'
            : 'Provider entry could not be verified'
        )
      }
    })
  }
}

function entry(
  claim: AshHookOwnershipClaim,
  state: AshClaudeHookClaimAudit['state'],
  detail: string
): AshClaudeHookClaimAudit {
  return { id: claim.id, event: claim.event, state, detail }
}
