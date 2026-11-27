/** One load into a profile session; cancellation keeps its lifecycle cause. */
export type BrowserExtensionProfileLoad = {
  extensionId: string
  cancelledBy: BrowserExtensionLoadCancellation | null
  settled: Promise<void>
}

export type BrowserExtensionLoadCancellation =
  | 'user-disabled'
  | 'superseded'
  | 'detached'
  | 'uninstalled'

export const BROWSER_EXTENSION_PROFILE_UNAVAILABLE =
  'Browser profile is not available for extensions'

export class BrowserExtensionLoadCancelledError extends Error {
  constructor(readonly cancelledBy: BrowserExtensionLoadCancellation = 'user-disabled') {
    super(
      cancelledBy === 'user-disabled'
        ? 'The extension was turned off before it finished loading'
        : cancelledBy === 'superseded'
          ? 'The extension load was superseded by a reload'
          : cancelledBy === 'detached'
            ? 'The extension profile was detached before it finished loading'
            : 'The extension was uninstalled before it finished loading'
    )
    this.name = 'BrowserExtensionLoadCancelledError'
  }
}

export function throwIfBrowserExtensionLoadCancelled(load: BrowserExtensionProfileLoad): void {
  if (load.cancelledBy) {
    throw new BrowserExtensionLoadCancelledError(load.cancelledBy)
  }
}

const cancellationPriority: Record<BrowserExtensionLoadCancellation, number> = {
  superseded: 0,
  'user-disabled': 1,
  uninstalled: 2,
  detached: 3
}

/**
 * Every load into one profile session runs through here, so an unload can cancel it and a detach
 * can wait for it before purging the profile. Loads of one extension run one after another.
 */
export class BrowserExtensionProfileLoads {
  private readonly loads = new Set<BrowserExtensionProfileLoad>()
  private closed = false

  track<T>(
    extensionId: string,
    run: (load: BrowserExtensionProfileLoad) => Promise<T>
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error(BROWSER_EXTENSION_PROFILE_UNAVAILABLE))
    }
    const earlier = [...this.loads]
      .filter((load) => load.extensionId === extensionId)
      .map((load) => load.settled)
    const load: BrowserExtensionProfileLoad = {
      extensionId,
      cancelledBy: null,
      settled: Promise.resolve()
    }
    const running = Promise.all(earlier).then(() => run(load))
    load.settled = running.then(
      () => undefined,
      () => undefined
    )
    this.loads.add(load)
    void load.settled.then(() => this.loads.delete(load))
    return running
  }

  /** Cancels the loads of one extension, or all with null; resolves once they have stopped. */
  cancel(
    extensionId: string | null,
    cancelledBy: BrowserExtensionLoadCancellation
  ): Promise<unknown> {
    const cancelled = [...this.loads].filter(
      (load) => extensionId === null || load.extensionId === extensionId
    )
    for (const load of cancelled) {
      if (
        load.cancelledBy === null ||
        cancellationPriority[cancelledBy] > cancellationPriority[load.cancelledBy]
      ) {
        load.cancelledBy = cancelledBy
      }
    }
    return Promise.all(cancelled.map((load) => load.settled))
  }

  /** Refuses new loads and cancels the rest; resolves once they have stopped. */
  close(cancelledBy: BrowserExtensionLoadCancellation = 'detached'): Promise<unknown> {
    this.closed = true
    return this.cancel(null, cancelledBy)
  }
}
