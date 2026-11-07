/**
 * Ash does not offer remote-host or headless-serve management.
 * It must never auto-register another app's command in a user's PATH.
 */
export async function registerCliForHeadlessServe(): Promise<void> {
  // Unsupported in the local-only product.
}
