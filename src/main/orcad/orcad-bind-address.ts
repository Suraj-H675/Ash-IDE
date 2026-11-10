// SSH forwarding needs only loopback; network exposure must be an explicit operator choice.
import { isIP } from 'node:net'
import type { OrcadOptions } from './orcad-start-contract'

export const ORCAD_LOOPBACK_BIND_HOST = '127.0.0.1'
const ALL_INTERFACES_V4 = '0.0.0.0'
const ALL_INTERFACES_V6 = '::'

export class OrcadBindAddressError extends Error {
  readonly code = 'orcad_invalid_bind_address'
}

/** Require literal IPs so DNS cannot silently choose a public/private bind interface. */
export function resolveOrcadBindHost(raw?: string): string {
  if (raw === undefined) {
    return ORCAD_LOOPBACK_BIND_HOST
  }
  const value = raw.trim()
  if (value === '') {
    throw new OrcadBindAddressError('--bind expects an address')
  }
  if (value === 'localhost') {
    return ORCAD_LOOPBACK_BIND_HOST
  }
  if (isIP(value) === 0) {
    throw new OrcadBindAddressError(
      `--bind expects a literal IP address (got '${value}'). Hostnames are refused because ` +
        'DNS decides which interface would be bound. Ash accepts loopback only.'
    )
  }
  if (bindHostIsNetworkExposed(value)) {
    throw new OrcadBindAddressError(
      `--bind ${value} would expose runtime control beyond this computer; Ash accepts loopback addresses only.`
    )
  }
  return value
}

/** Validate before opening profile data, starting the terminal daemon, or binding RPC. */
export function assertOrcadLocalOnlyOptions(
  options: Pick<OrcadOptions, 'bind' | 'mobilePairing' | 'pairingAddress' | 'grantDesktopControl'>
): string {
  const bindHost = resolveOrcadBindHost(options.bind)
  if (
    options.mobilePairing ||
    options.pairingAddress !== undefined ||
    options.grantDesktopControl
  ) {
    throw new OrcadBindAddressError(
      'Ash IDE does not support mobile pairing, advertised pairing addresses, or remote desktop-control grants.'
    )
  }
  return bindHost
}

export function bindHostIsNetworkExposed(host: string): boolean {
  if (host === ALL_INTERFACES_V4 || host === ALL_INTERFACES_V6) {
    return true
  }
  if (isIP(host) === 4) {
    return !host.startsWith('127.')
  }
  return host !== '::1'
}

export function describeOrcadBindExposure(host: string): string {
  return bindHostIsNetworkExposed(host)
    ? `Rejected Orcad network-exposed address ${host}; Ash runtime control must stay local.`
    : `Ash runtime is bound to ${host} (local only). Remote pairing and LAN control are unavailable.`
}
