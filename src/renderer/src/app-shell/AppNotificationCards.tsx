import { Suspense, type JSX } from 'react'
import type { TopLevelView } from '../../../shared/ui-chrome-types'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { CodexSharedSettingsNoticeCard } from '../components/CodexSharedSettingsNoticeCard'
import { NotificationCardStack } from '../components/NotificationCardStack'
import { OverlayBoundary } from './app-root-surface-boundaries'

const ChatUiHereCornerCard = lazy(() =>
  import('../components/feature-tips/ChatUiHereCornerCard').then((module) => ({
    default: module.ChatUiHereCornerCard
  }))
)
const UpdateCard = lazy(() =>
  import('../components/UpdateCard').then((module) => ({ default: module.UpdateCard }))
)

/** The bottom-right notification stack and every card that shares it. */
export function AppNotificationCards({
  activeView,
  shouldMountUpdateCard,
  chatUiHereCornerCardOpen,
  onChatUiHereCornerCardClose
}: {
  activeView: TopLevelView
  shouldMountUpdateCard: boolean
  chatUiHereCornerCardOpen: boolean
  onChatUiHereCornerCardClose: () => void
}): JSX.Element {
  return (
    <NotificationCardStack>
      {chatUiHereCornerCardOpen ? (
        <Suspense fallback={null}>
          <OverlayBoundary boundaryId="overlay.chat-ui-here-corner-card" resetKey={activeView}>
            <ChatUiHereCornerCard onClose={onChatUiHereCornerCardClose} />
          </OverlayBoundary>
        </Suspense>
      ) : null}
      {shouldMountUpdateCard ? (
        <Suspense fallback={null}>
          <OverlayBoundary boundaryId="overlay.update-card" resetKey={activeView}>
            <UpdateCard />
          </OverlayBoundary>
        </Suspense>
      ) : null}
      <OverlayBoundary boundaryId="overlay.codex-shared-settings-notice" resetKey={activeView}>
        <CodexSharedSettingsNoticeCard />
      </OverlayBoundary>
    </NotificationCardStack>
  )
}
