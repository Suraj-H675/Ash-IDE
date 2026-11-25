import { BrowserManagerViewportScrollState } from './browser-manager-viewport-scroll-state'

export type OffscreenBrowserGuestOwnerReplacement = {
  browserPageId: string
  previousWebContentsId: number
  nextWebContentsId: number
}

export abstract class BrowserManagerOffscreenOwnerState extends BrowserManagerViewportScrollState {
  protected readonly offscreenOwnerReplacementListeners = new Set<
    (replacement: OffscreenBrowserGuestOwnerReplacement) => void
  >()

  onOffscreenGuestOwnerReplaced(
    listener: (replacement: OffscreenBrowserGuestOwnerReplacement) => void
  ): () => void {
    this.offscreenOwnerReplacementListeners.add(listener)
    return () => this.offscreenOwnerReplacementListeners.delete(listener)
  }

  protected notifyOffscreenGuestOwnerReplaced(
    replacement: OffscreenBrowserGuestOwnerReplacement
  ): void {
    for (const listener of this.offscreenOwnerReplacementListeners) {
      try {
        listener(replacement)
      } catch (error) {
        console.error('[browser-manager] offscreen owner replacement listener failed', error)
      }
    }
  }
}
