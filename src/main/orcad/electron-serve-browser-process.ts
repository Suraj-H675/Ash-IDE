import type { ChildProcessHandle as ChildProcess } from '@orca/process-host/process-spec'
import {
  BROWSER_EXPECT_URL_RUNTIME_CAPABILITY,
  BROWSER_GOOGLE_COOKIE_CLEAR_CAPABILITY
} from '../../shared/browser-runtime-capabilities'
import {
  BROWSER_EXPECT_URL_UNSUPPORTED_CODE,
  BrowserExpectedUrlMismatch
} from '../../shared/browser/client-hosting/browser-expected-url'
import { browserExpectedUrlMismatchError } from '../browser/cdp/input/browser-expected-page-url'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { BrowserError } from '../browser/browser-error'
import type { RuntimeBrowserCommandHost } from '../runtime/browser/commands/browser-command-contracts'
import type { RuntimeBrowserCommands } from '../runtime/browser/commands/browser-commands'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { BROWSER_UNAVAILABLE_ERROR_CODE } from '../../shared/runtime-types'
import { readRuntimeMetadata } from '../runtime/rpc/server/runtime-metadata'
import { sendOrcadSidecarRequest } from './orcad-sidecar-runtime-client'
import { browserWaitRequestTimeoutMs } from '../../shared/browser-wait-timeout'
import { reserveLoopbackPort } from './loopback-port-reservation'
import {
  createElectronSidecarProfile,
  confirmElectronSidecarCleanup,
  electronSidecarIsAvailable,
  electronSidecarPid,
  removeNeverLaunchedElectronSidecarProfile,
  removeLeftoverElectronSidecarProfile,
  spawnElectronSidecar
} from './electron-sidecar-profile'
import {
  ElectronSidecarTabRegistry,
  ElectronSidecarTabSchema,
  type ElectronSidecarPage
} from './electron-sidecar-tab-registry'
import {
  electronSidecarRuntimeMethodName,
  TARGETLESS_BROWSER_METHODS
} from './electron-sidecar-method-routing'

const START_TIMEOUT_MS = 120_000
const BrowserPageResult = z.object({ browserPageId: z.string() }).passthrough()
const BrowserCloseResult = z.object({ closed: z.boolean() }).passthrough()
const BrowserTabListResult = z.object({ tabs: z.array(ElectronSidecarTabSchema) }).passthrough()
const RuntimeStatusResult = z.object({ capabilities: z.array(z.string()).optional() }).passthrough()
const RuntimeTransportMetadata = z
  .object({
    kind: z.enum(['unix', 'named-pipe', 'websocket']),
    endpoint: z.string().min(1)
  })
  .passthrough()
const SidecarRuntimeMetadata = z
  .object({
    runtimeId: z.string().min(1),
    pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    transports: z.array(RuntimeTransportMetadata).optional(),
    transport: RuntimeTransportMetadata.optional(),
    authToken: z.string().nullable(),
    startedAt: z.number().finite()
  })
  .passthrough()
  .refine(
    (metadata) =>
      metadata.transports?.some((transport) => transport.kind !== 'websocket') === true ||
      (metadata.transport !== undefined && metadata.transport.kind !== 'websocket')
  )

function readSidecarRuntimeMetadata(userDataPath: string): RuntimeMetadata | null {
  try {
    const parsed = SidecarRuntimeMetadata.safeParse(readRuntimeMetadata(userDataPath))
    if (!parsed.success) {
      return null
    }
    const metadata = parsed.data
    return {
      runtimeId: metadata.runtimeId,
      pid: metadata.pid,
      transports: metadata.transports?.length
        ? metadata.transports
        : metadata.transport
          ? [metadata.transport]
          : [],
      authToken: metadata.authToken,
      startedAt: metadata.startedAt
    }
  } catch {
    return null
  }
}

export class ElectronServeBrowserProcess {
  private child: ChildProcess | null = null
  private metadata: RuntimeMetadata | null = null
  private readonly tabs = new ElectronSidecarTabRegistry()
  private sidecarCapabilities: readonly string[] = []
  private sidecarDataPath: string | null = null
  private sidecarProfileSpawned = false
  private cleanupUncertain = false

  constructor(
    private readonly executablePath: string,
    private readonly orcadUserDataPath: string
  ) {}

  async start(signal?: AbortSignal): Promise<void> {
    this.sidecarCapabilities = []
    signal?.throwIfAborted()
    if (this.child || this.sidecarDataPath || this.cleanupUncertain) {
      await this.stop()
    }
    if (!(await removeLeftoverElectronSidecarProfile(this.orcadUserDataPath))) {
      this.cleanupUncertain = true
      throw new Error(
        'A previous Electron browser profile has no verifiable owner. Its data was preserved, and startup is blocked to avoid duplicating an uncertain live session. Close all Ash/Orca browser processes and get user-mediated recovery of the saved profile before retrying.'
      )
    }
    this.cleanupUncertain = false
    const userDataPath = await createElectronSidecarProfile(
      this.orcadUserDataPath,
      this.executablePath
    )
    this.sidecarDataPath = userDataPath
    this.sidecarProfileSpawned = false
    const port = await reserveLoopbackPort()
    signal?.throwIfAborted()
    const child = spawnElectronSidecar(this.executablePath, userDataPath, port)
    this.child = child
    this.sidecarProfileSpawned = true
    let spawnError: unknown = null
    // Bundle swaps can race restart; report ENOENT as start failure without crashing orcad.
    child.on('error', (error) => {
      spawnError = error
    })
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('error', () => undefined)
      stream?.resume()
    }
    const deadline = Date.now() + START_TIMEOUT_MS
    let lastError: unknown = null
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      const metadata = readSidecarRuntimeMetadata(userDataPath)
      if (metadata) {
        try {
          const status = RuntimeStatusResult.parse(
            await sendOrcadSidecarRequest(metadata, 'status.get', undefined, 5_000)
          )
          signal?.throwIfAborted()
          if (status.capabilities?.includes('browser.headless.v1')) {
            this.sidecarCapabilities = status.capabilities
            this.metadata = metadata
            return
          }
          lastError = new Error('Installed Electron app omitted browser.headless.v1.')
        } catch (error) {
          lastError = error
        }
      }
      if (spawnError) {
        lastError = spawnError
        break
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        break
      }
      await delay(100, undefined, { signal })
    }
    throw new Error(
      `Installed Electron browser provider did not become ready: ${
        lastError instanceof Error ? lastError.message : 'no runtime metadata'
      }`
    )
  }

  createCommands(host: RuntimeBrowserCommandHost): RuntimeBrowserCommands {
    const target: RuntimeBrowserCommands = Object.create(null)
    return new Proxy(target, {
      // Startup checks membership before resolving commands dynamically.
      has: (_target, property) => typeof property === 'string' && property !== 'then',
      get: (_target, property) => {
        if (property === 'then' || typeof property !== 'string') {
          return undefined
        }
        return (...args: unknown[]) => this.invoke(host, property, args)
      }
    })
  }
  supportsGoogleCookieClear(): boolean {
    return (
      this.isAvailable() &&
      this.sidecarCapabilities.includes(BROWSER_GOOGLE_COOKIE_CLEAR_CAPABILITY)
    )
  }

  isAvailable(): boolean {
    return electronSidecarIsAvailable(this.child, this.metadata?.pid ?? null)
  }

  hasHostOwnedCleanup(): boolean {
    return this.cleanupUncertain
  }

  /** Read child exit state so recycled PIDs cannot identify an unrelated process. */
  pid(): number | null {
    return electronSidecarPid(this.child, this.metadata?.pid ?? null)
  }

  async stop(): Promise<void> {
    const child = this.child
    const sidecarDataPath = this.sidecarDataPath
    this.cleanupUncertain = Boolean(child || sidecarDataPath || this.cleanupUncertain)
    this.tabs.clear()
    const cleanupConfirmed = child
      ? await confirmElectronSidecarCleanup(child, this.orcadUserDataPath, this.cleanupUncertain)
      : sidecarDataPath && !this.sidecarProfileSpawned
        ? await removeNeverLaunchedElectronSidecarProfile(this.orcadUserDataPath, sidecarDataPath)
        : await confirmElectronSidecarCleanup(null, this.orcadUserDataPath, this.cleanupUncertain)
    if (!cleanupConfirmed) {
      throw new Error('Electron browser sidecar cleanup remains unresolved.')
    }

    this.child = null
    this.metadata = null
    this.sidecarCapabilities = []
    this.sidecarDataPath = null
    this.sidecarProfileSpawned = false
    this.cleanupUncertain = false
  }

  private async invoke(
    host: RuntimeBrowserCommandHost,
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    if (method === 'browserScreencast') {
      throw new BrowserError(
        'browser_screencast_unavailable',
        'The orcad Electron provider does not proxy screencast.'
      )
    }
    const metadata = this.metadata
    if (!metadata) {
      throw new BrowserError(
        BROWSER_UNAVAILABLE_ERROR_CODE,
        'The Electron browser provider is not running.'
      )
    }
    const parsedOriginal = z.record(z.string(), z.unknown()).safeParse(args[0] ?? {})
    const original = parsedOriginal.success ? parsedOriginal.data : {}
    // The sidecar is the installed app, which can be older and would drop the field.
    if (
      original.expectUrl !== undefined &&
      !this.sidecarCapabilities.includes(BROWSER_EXPECT_URL_RUNTIME_CAPABILITY)
    ) {
      throw new BrowserError(
        BROWSER_EXPECT_URL_UNSUPPORTED_CODE,
        'The installed Orca app that runs this server’s browser cannot check --expect-url. Update it or drop the flag.'
      )
    }
    const worktreeId =
      typeof original.worktree === 'string'
        ? (await host.resolveBrowserWorkspace(original.worktree)).id
        : undefined
    const params: Record<string, unknown> = { ...original, worktree: undefined }
    const requestedPageId = typeof original.page === 'string' ? original.page : undefined
    const requestedIndex = typeof original.index === 'number' ? original.index : undefined
    let targetPage: ElectronSidecarPage | undefined
    let rpcMethod = electronSidecarRuntimeMethodName(method)
    if (method === 'browserTabCreate' && requestedPageId) {
      const existing = this.tabs.find(requestedPageId)
      if (existing) {
        this.tabs.require(requestedPageId, worktreeId)
        return { browserPageId: requestedPageId }
      }
      // Sidecars mint their own IDs; adopt the caller’s provisional ID after creation.
      delete params.page
    }

    if (method === 'browserTabCurrent' && worktreeId) {
      targetPage = this.tabs.active(worktreeId)
      rpcMethod = 'browser.tabShow'
      params.page = targetPage.sidecarPageId
    } else if (method === 'browserTabSwitch' || method === 'browserTabClose') {
      targetPage = requestedPageId
        ? this.tabs.require(requestedPageId, worktreeId)
        : requestedIndex !== undefined
          ? this.tabs.pageAt(worktreeId, requestedIndex)
          : worktreeId
            ? this.tabs.active(worktreeId)
            : undefined
      if (targetPage) {
        params.page = targetPage.sidecarPageId
        delete params.index
      }
    } else if (requestedPageId && method !== 'browserTabCreate') {
      targetPage = this.tabs.require(requestedPageId, worktreeId)
      params.page = targetPage.sidecarPageId
    } else if (worktreeId && !TARGETLESS_BROWSER_METHODS[method]) {
      targetPage = this.tabs.active(worktreeId)
      params.page = targetPage.sidecarPageId
    }

    let result: unknown
    try {
      result = await sendOrcadSidecarRequest(
        metadata,
        rpcMethod,
        params,
        method === 'browserWait' ? browserWaitRequestTimeoutMs(params.timeout) : undefined
      )
    } catch (error) {
      if (
        targetPage &&
        error instanceof BrowserError &&
        (error.code === 'browser_tab_not_found' || error.code === 'browser_tab_closed')
      ) {
        this.tabs.delete(targetPage)
      }
      // The sidecar named its own page id, which the caller's --page can't use.
      const mismatch =
        error instanceof BrowserError
          ? BrowserExpectedUrlMismatch.safeParse(this.tabs.rewriteResult(error.data))
          : null
      throw mismatch?.success ? browserExpectedUrlMismatchError(mismatch.data) : error
    }
    if (method === 'browserTabCreate') {
      const created = BrowserPageResult.parse(result)
      const page = this.tabs.register(created.browserPageId, requestedPageId, worktreeId)
      return { ...created, browserPageId: page.publicPageId }
    }
    if (method === 'browserTabList') {
      const listed = BrowserTabListResult.parse(result)
      return { ...listed, tabs: this.tabs.reconcileTabs(listed.tabs, worktreeId) }
    }
    if (method === 'browserTabSwitch') {
      const switched = BrowserPageResult.parse(result)
      const page = this.tabs.pageForSidecar(switched.browserPageId)
      if (page) {
        this.tabs.setActive(page)
      }
      return {
        ...switched,
        ...(requestedIndex !== undefined ? { switched: requestedIndex } : {}),
        browserPageId: this.tabs.publicPageId(switched.browserPageId)
      }
    }
    if (method === 'browserTabClose' && targetPage) {
      const closed = BrowserCloseResult.parse(result)
      if (closed.closed) {
        this.tabs.delete(targetPage)
      }
      return closed
    }
    if (method === 'browserTabProfileClone') {
      const cloned = BrowserPageResult.parse(result)
      this.tabs.register(cloned.browserPageId, undefined, targetPage?.worktreeId)
    }
    return this.tabs.rewriteResult(result)
  }
}
