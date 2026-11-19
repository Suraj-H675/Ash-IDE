import { activeWindowMaterial } from './window-material-runtime'

/** The window material paints under translucent terminal panes. */
export function windowBackdropActive(): boolean {
  return activeWindowMaterial() !== 'off'
}

export function useWindowBackdropActive(): boolean {
  return activeWindowMaterial() !== 'off'
}
