/**
 * Ash disables Jira and Linear status requests at the renderer boundary.
 * This gates status requests only; other explicit tracker methods remain legacy
 * behavior and need a separate M8 audit before vertical removal.
 */
export const ASH_TASK_TRACKER_STATUS_ENABLED = false
