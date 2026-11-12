import { CODEX_PENDING_LOGIN_URL_CHANGED_CHANNEL } from '../../shared/codex-auth-errors'
import { sendToTrustedUIRenderer } from './ui'

export function broadcastCodexPendingLoginUrl(url: string | null): void {
  // OAuth state can appear in provider sign-in URLs. Never broadcast to an
  // arbitrary browser, plugin iframe, or unrelated Electron popout window.
  sendToTrustedUIRenderer(CODEX_PENDING_LOGIN_URL_CHANGED_CHANNEL, url)
}
