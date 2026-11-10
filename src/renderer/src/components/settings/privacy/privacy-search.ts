import { createLocalizedCatalog } from '@/i18n/localized-catalog'

/** Ash's privacy page contains only local diagnostic review, never product analytics opt-in. */
export const getPrivacyPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: 'Local privacy and diagnostics',
    description:
      'Review local diagnostic files. Ash IDE does not upload reports or product analytics.',
    keywords: ['privacy', 'diagnostics', 'local', 'logs', 'review', 'redaction', 'export']
  }
])
