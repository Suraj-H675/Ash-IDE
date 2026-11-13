// Ash's CLI command/spec registry has no Jira or Linear command root. These
// inherited compiled command modules are unreachable from the supported Ash
// CLI, but TypeScript still emits them into out/cli. Keep this exact list
// narrow: retained reference/worktree commands still use some shared tracker
// parsing utilities (including cli/jira-target and worktree-linear-issue-link).
const EXCLUDED_TASK_TRACKER_CLI_ARTIFACTS = Object.freeze([
  'out/cli/handlers/jira.js',
  'out/cli/handlers/jira-write.js',
  'out/cli/handlers/linear.js',
  'out/cli/handlers/linear-comment-write.js',
  'out/cli/handlers/linear-list-issues.js',
  'out/cli/handlers/linear-relation-write.js',
  'out/cli/handlers/linear-save-issue.js',
  'out/cli/jira-format.js',
  'out/cli/jira-handler-group.js',
  'out/cli/linear-format.js',
  'out/cli/linear-handler-group.js',
  'out/cli/linear-request-builders.js',
  'out/cli/linear-save-issue-request.js',
  'out/cli/specs/jira.js',
  'out/cli/specs/linear.js',
  'out/cli/specs/linear-mcp.js'
])

module.exports = { EXCLUDED_TASK_TRACKER_CLI_ARTIFACTS }
