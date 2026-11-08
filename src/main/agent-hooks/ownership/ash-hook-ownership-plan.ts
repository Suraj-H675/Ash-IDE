import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, normalize } from 'node:path'
import { isPlainObject } from '../hooks-json-read'

/**
 * Ash-only, *inert* ownership planning for a Claude-compatible JSON hook.
 * No production caller may write the resulting provider config while
 * canAshWriteProviderGlobalHooks() is false. Windows and Codex are NOT covered.
 */
export type AshHookOwnershipClaim = {
  id: string
  provider: 'claude'
  configPath: string
  event: string
  definitionSha256: string
  /** Prepared claims are persisted BEFORE any provider-file write. */
  state: 'prepared' | 'installed'
}

export type AshHookOwnershipLedger = {
  schemaVersion: 1
  owner: 'ash-ide'
  claims: AshHookOwnershipClaim[]
}

export type AshHookPlan = {
  config: Record<string, unknown>
  ledger: AshHookOwnershipLedger
  claim: AshHookOwnershipClaim
}

export class AshHookOwnershipConflict extends Error {
  constructor(reason: string) {
    super(`Ash provider-hook ownership conflict: ${reason}`)
    this.name = 'AshHookOwnershipConflict'
  }
}

export function emptyAshHookOwnershipLedger(): AshHookOwnershipLedger {
  return { schemaVersion: 1, owner: 'ash-ide', claims: [] }
}

const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const SHA256 = /^[\da-f]{64}$/
const EVENT = /^[A-Z][A-Za-z0-9]{0,63}$/
const MAX_CLAIMS = 128

function pathIsSafe(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 4096 &&
    isAbsolute(path) &&
    normalize(path) === path &&
    !path.includes('\0')
  )
}

export function validateAshHookOwnershipLedger(value: unknown): AshHookOwnershipLedger {
  if (
    !isPlainObject(value) ||
    value.schemaVersion !== 1 ||
    value.owner !== 'ash-ide' ||
    !Array.isArray(value.claims) ||
    value.claims.length > MAX_CLAIMS
  ) {
    throw new AshHookOwnershipConflict('unknown, corrupt, or oversized ledger')
  }
  const seen = new Set<string>()
  const claims: AshHookOwnershipClaim[] = []
  for (const valueClaim of value.claims) {
    if (
      !isPlainObject(valueClaim) ||
      typeof valueClaim.id !== 'string' ||
      !UUID_V4.test(valueClaim.id) ||
      valueClaim.provider !== 'claude' ||
      !pathIsSafe(valueClaim.configPath) ||
      typeof valueClaim.event !== 'string' ||
      !EVENT.test(valueClaim.event) ||
      typeof valueClaim.definitionSha256 !== 'string' ||
      !SHA256.test(valueClaim.definitionSha256) ||
      (valueClaim.state !== 'prepared' && valueClaim.state !== 'installed') ||
      seen.has(valueClaim.id)
    ) {
      throw new AshHookOwnershipConflict('invalid or duplicate ownership claim')
    }
    seen.add(valueClaim.id)
    claims.push({
      id: valueClaim.id,
      provider: 'claude',
      configPath: valueClaim.configPath,
      event: valueClaim.event,
      definitionSha256: valueClaim.definitionSha256,
      state: valueClaim.state
    })
  }
  return { schemaVersion: 1, owner: 'ash-ide', claims }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function checkConfig(
  config: unknown,
  event: string
): {
  config: Record<string, unknown>
  hooks: Record<string, unknown>
  definitions: unknown[]
} {
  if (!isPlainObject(config)) {
    throw new AshHookOwnershipConflict('unparseable or non-object provider configuration')
  }
  if (config.hooks !== undefined && !isPlainObject(config.hooks)) {
    throw new AshHookOwnershipConflict('provider hooks node is malformed')
  }
  const hooks = isPlainObject(config.hooks) ? config.hooks : {}
  if (hooks[event] !== undefined && !Array.isArray(hooks[event])) {
    throw new AshHookOwnershipConflict('provider event node is malformed')
  }
  const definitions = (hooks[event] as unknown[] | undefined) ?? []
  if (
    definitions.some(
      (definition) =>
        !isPlainObject(definition) ||
        (definition.hooks !== undefined &&
          (!Array.isArray(definition.hooks) ||
            definition.hooks.some((hook) => !isPlainObject(hook))))
    )
  ) {
    throw new AshHookOwnershipConflict('provider event contains malformed hook definitions')
  }
  return { config, hooks, definitions }
}

function marker(id: string): string {
  return `ASH_IDE_HOOK_OWNER=${id} `
}

/** Plan one POSIX Claude command hook. An explicit UUID never reuses an existing foreign command. */
export function planAshClaudeHookInstall(args: {
  ledger: unknown
  config: unknown
  configPath: string
  event: string
  command: string
  id?: string
}): AshHookPlan {
  const ledger = validateAshHookOwnershipLedger(args.ledger)
  if (!pathIsSafe(args.configPath) || !EVENT.test(args.event)) {
    throw new AshHookOwnershipConflict('invalid provider target')
  }
  if (
    typeof args.command !== 'string' ||
    args.command.length === 0 ||
    args.command.length > 4096 ||
    /[\r\n\0]/.test(args.command) ||
    args.command.includes('ASH_IDE_HOOK_OWNER=')
  ) {
    throw new AshHookOwnershipConflict('untrusted hook command')
  }
  if (ledger.claims.length >= MAX_CLAIMS) {
    throw new AshHookOwnershipConflict('ownership ledger capacity reached')
  }
  const id = args.id ?? randomUUID()
  if (!UUID_V4.test(id) || ledger.claims.some((claim) => claim.id === id)) {
    throw new AshHookOwnershipConflict('invalid or reused installation identity')
  }
  const { config, hooks, definitions } = checkConfig(args.config, args.event)
  if (canonical(config).includes(marker(id))) {
    throw new AshHookOwnershipConflict('installation identity already present in provider config')
  }
  const definition = { hooks: [{ type: 'command', command: marker(id) + args.command }] }
  const claim: AshHookOwnershipClaim = {
    id,
    provider: 'claude',
    configPath: args.configPath,
    event: args.event,
    definitionSha256: sha256(definition),
    state: 'prepared'
  }
  return {
    config: { ...config, hooks: { ...hooks, [args.event]: [...definitions, definition] } },
    ledger: { ...ledger, claims: [...ledger.claims, claim] },
    claim
  }
}

function locateClaimDefinition(
  config: unknown,
  claim: AshHookOwnershipClaim
): {
  config: Record<string, unknown>
  hooks: Record<string, unknown>
  definitions: unknown[]
  index: number
} {
  const { config: parsed, hooks, definitions } = checkConfig(config, claim.event)
  // A marker duplicated in another event is also ambiguous. Never infer
  // ownership from an event name alone when a provider has moved an entry.
  for (const [event, entries] of Object.entries(hooks)) {
    if (event !== claim.event && canonical(entries).includes(marker(claim.id))) {
      throw new AshHookOwnershipConflict('owned hook marker duplicated or moved')
    }
  }
  const matches: number[] = []
  for (const [index, definition] of definitions.entries()) {
    if (
      isPlainObject(definition) &&
      Array.isArray(definition.hooks) &&
      definition.hooks.some(
        (hook) =>
          isPlainObject(hook) &&
          typeof hook.command === 'string' &&
          hook.command.startsWith(marker(claim.id))
      )
    ) {
      matches.push(index)
    }
  }
  if (matches.length !== 1) {
    throw new AshHookOwnershipConflict('owned hook marker missing or ambiguous')
  }
  if (sha256(definitions[matches[0]]) !== claim.definitionSha256) {
    throw new AshHookOwnershipConflict('owned hook modified after installation')
  }
  return { config: parsed, hooks, definitions, index: matches[0] }
}

/** Confirm a prepared record only after the provider file contains the exact planned entry. */
export function confirmAshClaudeHookInstall(args: {
  ledger: unknown
  config: unknown
  configPath: string
  id: string
}): AshHookOwnershipLedger {
  const ledger = validateAshHookOwnershipLedger(args.ledger)
  const claim = ledger.claims.find((entry) => entry.id === args.id)
  if (!claim || claim.configPath !== args.configPath || claim.state !== 'prepared') {
    throw new AshHookOwnershipConflict('no pending installation for this provider home')
  }
  locateClaimDefinition(args.config, claim)
  return {
    ...ledger,
    claims: ledger.claims.map((entry) =>
      entry.id === claim.id ? { ...entry, state: 'installed' as const } : entry
    )
  }
}

/** Clear a failed installation's prepared claim only if no owner marker is present. */
export function abandonAshClaudeHookInstall(args: {
  ledger: unknown
  config: unknown
  configPath: string
  id: string
}): AshHookOwnershipLedger {
  const ledger = validateAshHookOwnershipLedger(args.ledger)
  const claim = ledger.claims.find((entry) => entry.id === args.id)
  if (!claim || claim.configPath !== args.configPath || claim.state !== 'prepared') {
    throw new AshHookOwnershipConflict('no pending installation for this provider home')
  }
  if (!isPlainObject(args.config) || canonical(args.config).includes(marker(claim.id))) {
    throw new AshHookOwnershipConflict('pending hook may still exist or config is unreadable')
  }
  return { ...ledger, claims: ledger.claims.filter((entry) => entry.id !== claim.id) }
}

/**
 * Refuse deletion if the claim, unique marker, location, or full entry changed.
 * Never match an entry merely because its script name or command resembles Ash.
 */
export function planAshClaudeHookRemoval(args: {
  ledger: unknown
  config: unknown
  configPath: string
  id: string
}): AshHookPlan {
  const ledger = validateAshHookOwnershipLedger(args.ledger)
  const claim = ledger.claims.find((entry) => entry.id === args.id)
  if (!claim || claim.configPath !== args.configPath) {
    throw new AshHookOwnershipConflict('missing claim or wrong provider home')
  }
  const { config, hooks, definitions, index } = locateClaimDefinition(args.config, claim)
  const remaining = definitions.filter((_, candidate) => candidate !== index)
  const nextHooks = { ...hooks }
  if (remaining.length) {
    nextHooks[claim.event] = remaining
  } else {
    delete nextHooks[claim.event]
  }
  return {
    config: { ...config, hooks: nextHooks },
    ledger: { ...ledger, claims: ledger.claims.filter((entry) => entry.id !== claim.id) },
    claim
  }
}
