import {
  clearElectronProxyCredentialsForSession,
  resetElectronProxyCredentialsForTests,
  type ElectronProxyCredentials
} from './electron-proxy-credentials'
import type { ProxySession } from './electron-default-proxy-session'
import { runBoundedProxyApplication } from './bounded-proxy-application'
import type { ProxyApplyResult } from './proxy-policy-resolution'

export type SessionProxyApplicationState = {
  appliedKey: string | null
  settledKey: string | null
  appliedResult: Extract<ProxyApplyResult, { source: 'settings' | 'env' }> | null
  credentials: ElectronProxyCredentials | null
  tail: Promise<unknown>
  readiness: 'ready' | 'pending' | 'failed'
  retired: boolean
}
let sessionProxyApplications = new WeakMap<ProxySession, SessionProxyApplicationState>()

export function resetProxyApplicationForTests(): void {
  sessionProxyApplications = new WeakMap()
  resetElectronProxyCredentialsForTests()
}

export function resetSessionProxyApplicationForTests(proxySession: ProxySession): void {
  sessionProxyApplications.delete(proxySession)
  clearElectronProxyCredentialsForSession(proxySession)
}

export function clearProxySessionCredentials(proxySession: ProxySession): void {
  const state = sessionProxyApplications.get(proxySession)
  if (state) {
    state.credentials = null
  }
  clearElectronProxyCredentialsForSession(proxySession)
}

/** Wait for the newest policy; apply errors keep requests fail-closed. */
export async function awaitProxySessionApplication(proxySession: ProxySession): Promise<boolean> {
  while (true) {
    const state = sessionProxyApplications.get(proxySession)
    if (!state || state.retired) {
      return !state
    }
    const observed = state.tail
    try {
      await observed
    } catch {
      if (state.tail === observed) {
        return false
      }
      continue
    }
    if (state.tail === observed) {
      return !state.retired
    }
  }
}

export function getProxySessionApplicationReadiness(
  proxySession: ProxySession
): boolean | Promise<boolean> {
  const state = sessionProxyApplications.get(proxySession)
  if (!state) {
    return true
  }
  if (state.retired || state.readiness === 'failed') {
    return false
  }
  if (state.readiness === 'ready') {
    return true
  }
  return awaitProxySessionApplication(proxySession)
}

/** Deny new requests without changing the retired session's configured route. */
export async function fenceProxySessionApplication(proxySession: ProxySession): Promise<void> {
  const state = getSessionProxyApplicationState(proxySession)
  state.retired = true
  clearProxySessionCredentials(proxySession)
  await state.tail.catch(() => {})
  clearProxySessionCredentials(proxySession)
  await proxySession.closeAllConnections?.()
}

export function getSessionProxyApplicationState(
  proxySession: ProxySession
): SessionProxyApplicationState {
  let state = sessionProxyApplications.get(proxySession)
  if (!state) {
    state = {
      appliedKey: null,
      settledKey: null,
      appliedResult: null,
      credentials: null,
      tail: Promise.resolve(),
      readiness: 'ready',
      retired: false
    }
    sessionProxyApplications.set(proxySession, state)
  }
  return state
}

export async function enqueueSessionProxyApplication(
  proxySession: ProxySession,
  apply: (state: SessionProxyApplicationState) => Promise<ProxyApplyResult>,
  allowRetired = false
): Promise<ProxyApplyResult> {
  const state = getSessionProxyApplicationState(proxySession)
  if (state.retired && !allowRetired) {
    throw new Error('Proxy session is retired')
  }
  const operation = state.tail
    .catch(() => {})
    .then(() =>
      runBoundedProxyApplication(() => {
        if (state.retired && !allowRetired) {
          throw new Error('Proxy session is retired')
        }
        return apply(state)
      })
    )
  state.tail = operation
  state.readiness = 'pending'
  void operation.then(
    () => {
      if (state.tail === operation) {
        state.readiness = 'ready'
      }
    },
    () => {
      if (state.tail === operation) {
        state.readiness = 'failed'
      }
    }
  )
  return operation
}
