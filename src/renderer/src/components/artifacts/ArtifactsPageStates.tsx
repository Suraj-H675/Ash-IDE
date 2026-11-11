import { Files, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export function ArtifactsPageErrorBanner({
  error,
  loading,
  onRetry
}: {
  error: string
  loading: boolean
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-3 py-2 md:px-5">
      <p className="min-w-0 flex-1 text-xs text-destructive">{error}</p>
      <Button type="button" variant="outline" size="xs" disabled={loading} onClick={onRetry}>
        {translate('auto.components.artifacts.ArtifactsPage.retry', 'Retry')}
      </Button>
    </div>
  )
}

export function ArtifactsPageUnavailableState(): React.JSX.Element {
  return (
    <div className="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 px-5 py-5 text-center md:px-8">
      <Files className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {translate(
            'auto.components.artifacts.ArtifactsPage.cloudUnavailableHeading',
            'Cloud artifact sharing is unavailable in Ash IDE.'
          )}
        </h2>
        <p className="max-w-sm text-xs leading-5 text-muted-foreground">
          {translate(
            'auto.components.artifacts.ArtifactsPage.cloudUnavailableCopy',
            'Ash IDE does not provide Orca cloud sign-in or public artifact publishing. You can still preview HTML and Markdown files locally.'
          )}
        </p>
      </div>
    </div>
  )
}

export function ArtifactsPageEmptyState({
  hasMore,
  loadingMore,
  publishingBlocked,
  onLoadMore,
  onOpenArtifactsSettings
}: {
  hasMore: boolean
  loadingMore: boolean
  publishingBlocked: boolean
  onLoadMore: () => void
  onOpenArtifactsSettings: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-5 text-center md:px-8">
      <Files className="size-8 text-muted-foreground" />
      <h2 className="text-sm font-semibold">
        {hasMore
          ? translate(
              'auto.components.artifacts.ArtifactsPage.moreAvailable',
              'More artifacts are available'
            )
          : publishingBlocked
            ? translate(
                'auto.components.artifacts.ArtifactsPage.publishingOff',
                'Publishing is turned off'
              )
            : translate('auto.components.artifacts.ArtifactsPage.empty', 'No shared artifacts')}
      </h2>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">
        {hasMore
          ? translate(
              'auto.components.artifacts.ArtifactsPage.moreAvailableCopy',
              'Load the next page to continue.'
            )
          : publishingBlocked
            ? translate(
                'auto.components.artifacts.ArtifactsPage.publishingOffCopy',
                'Nothing on this device can create a public artifact link yet. Allow publishing in Settings → Artifacts, then share from an open HTML or Markdown file or ask your agent.'
              )
            : translate(
                'auto.components.artifacts.ArtifactsPage.emptyCopy',
                'Open an HTML or Markdown file and select Share as artifact, or ask your agent to share it.'
              )}
      </p>
      {!hasMore && publishingBlocked ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1"
          onClick={onOpenArtifactsSettings}
        >
          {translate(
            'auto.components.artifacts.ArtifactsPage.openArtifactsSettings',
            'Open Settings → Artifacts'
          )}
        </Button>
      ) : null}
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? <Loader2 className="animate-spin" /> : null}
          {translate('auto.components.artifacts.ArtifactCollection.loadMore', 'Load more')}
        </Button>
      ) : null}
    </div>
  )
}
