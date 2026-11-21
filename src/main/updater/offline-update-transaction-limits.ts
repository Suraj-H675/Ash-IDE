export const MAX_ARTIFACT_BYTES = 512 * 1024 ** 2

/** Stop before accumulated retained generations grow without a reviewed prune policy. */
export const MAX_RETAINED_GENERATIONS = 4

export const MAX_DOMAIN_FILES = 20_000

export const MAX_DOMAIN_BYTES = 1024 ** 3

export const MAX_DOMAINS = 64

export const MAX_TOTAL_STATE_FILES = 20_000

export const MAX_TOTAL_STATE_BYTES = 1024 ** 3

export const MAX_FILE_BYTES = 512 * 1024 ** 2

export const MAX_POINTER_BYTES = 16 * 1024

export const MAX_STATE_MANIFEST_BYTES = 128 * 1024 ** 2

export const MAX_RELATIVE_PATH_CHARS = 512

export const REQUIRED_EXCLUSIONS = [
  'provider-credentials',
  'projects-and-worktrees',
  'caches',
  'legacy-orca-user-data',
  'runtime-session-state'
] as const
