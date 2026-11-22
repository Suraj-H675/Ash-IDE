import { BrowserError } from '../browser/browser-error'
import { BROWSER_UNAVAILABLE_ERROR_CODE } from '../../shared/runtime-types'
import type { RuntimeBrowserCommands } from '../runtime/browser/commands/browser-commands'
import {
  browserUnavailableError,
  setRuntimeBrowserCommandsFactory
} from '../runtime/browser/installation/runtime-browser-commands-factory'
import {
  resolveOrcadBrowserProvider,
  type OrcadBrowserProvider,
  type OrcadBrowserProviderOptions
} from './orcad-browser-provider'
import { orcadClientPageCommand } from './orcad-client-page-commands'
import { registerHostedBrowserBackendProbe } from './orcad-browser-backend-positive-evidence'

/** Discover browsers asynchronously so authorization UI cannot block core RPC readiness. */
export function startOrcadBrowserProvider(options: OrcadBrowserProviderOptions): {
  ready: Promise<void>
  stop(): Promise<void>
} {
  const controller = new AbortController()
  let provider: OrcadBrowserProvider | null = null
  let startupError: unknown
  let stopping: Promise<void> | undefined
  let startupCleanupUncertain = false
  const engineAvailable = (): boolean => !controller.signal.aborted && !!provider?.isAvailable()
  let stoppingBackendWasAvailable = false
  // Read-only updater diagnostics observe the provider that this process
  // actually created, including while stop is still waiting on its cleanup.
  // Do not use engineAvailable: aborting command admission does not prove that
  // its process has stopped.
  const unregisterBrowserObservation = registerHostedBrowserBackendProbe(
    () =>
      stoppingBackendWasAvailable ||
      startupCleanupUncertain ||
      provider?.hasHostOwnedCleanup?.() === true ||
      provider?.isAvailable() === true
  )
  setRuntimeBrowserCommandsFactory(
    (host) => {
      let commands: RuntimeBrowserCommands | undefined
      const target: RuntimeBrowserCommands = Object.create(null)
      return new Proxy(target, {
        get: (_target, property) => {
          if (property === 'then' || typeof property !== 'string') {
            return undefined
          }
          const forward = (args: unknown[], name: string = property): unknown => {
            if (!engineAvailable() || !provider) {
              throw browserUnavailableError()
            }
            commands ??= provider.factory(host)
            return callBrowserCommand(commands, name, args)
          }
          return (
            orcadClientPageCommand(host, property, forward, engineAvailable) ??
            ((...args: unknown[]) => forward(args))
          )
        }
      })
    },
    {
      supportsGoogleCookieClear: () => provider?.supportsGoogleCookieClear?.() === true,
      headless: true,
      clientHostingWithoutEngine: true,
      isAvailable: engineAvailable
    }
  )
  const ready = Promise.resolve()
    .then(() =>
      resolveOrcadBrowserProvider({
        ...options,
        signal: controller.signal,
        onUnresolvedStartupCleanup: () => {
          startupCleanupUncertain = true
        }
      })
    )
    .then(
      // The factory still serves desktop-hosted pages when no engine provider resolves.
      (resolved) => {
        provider = resolved
      },
      (error: unknown) => {
        startupError = error
        if (!controller.signal.aborted) {
          console.warn('[orcad] Browser startup failed:', error)
        }
      }
    )
  return {
    ready,
    stop: () => {
      controller.abort()
      if (!stopping) {
        stopping = ready
          .then(async () => {
            // Both Chromium and Electron clear availability before awaiting child
            // cleanup. Preserve a positive observation until cleanup succeeds.
            try {
              stoppingBackendWasAvailable = provider?.isAvailable() === true
            } catch {
              // A failed status read cannot establish absence of a helper.
            }
            await provider?.stop()
            if (provider?.hasHostOwnedCleanup?.() !== true && !startupCleanupUncertain) {
              unregisterBrowserObservation()
              stoppingBackendWasAvailable = false
            } else {
              // A bounded stop attempt may resolve while cleanup remains uncertain.
              // Let a later caller retry instead of caching that unresolved state forever.
              stopping = undefined
            }
            // Resolver errors may include failed cleanup of partially started providers.
            if (startupError) {
              throw startupError
            }
          })
          .catch((error: unknown) => {
            stopping = undefined
            throw error
          })
      }
      return stopping
    }
  }
}

type BrowserCommandMember = (this: RuntimeBrowserCommands, ...args: unknown[]) => unknown

function isBrowserCommandMember(value: unknown): value is BrowserCommandMember {
  return typeof value === 'function'
}

function callBrowserCommand(
  commands: RuntimeBrowserCommands,
  name: string,
  args: unknown[]
): unknown {
  const member: unknown = name in commands ? commands[name] : undefined
  if (!isBrowserCommandMember(member)) {
    throw new BrowserError(BROWSER_UNAVAILABLE_ERROR_CODE, `Unknown browser command: ${name}`)
  }
  return member.call(commands, ...args)
}
