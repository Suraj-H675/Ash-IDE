import { globSync } from 'node:fs'
import { defaultExclude } from 'vitest/config'

export const UNIT_INCLUDE = [
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'config/scripts/**/*.test.ts',
  'config/scripts/**/*.test.mjs',
  'tests/tools/**/*.test.mjs',
  'tests/e2e/**/*.unit.test.ts'
]

export const UNIT_SETUP_FILES = [
  'config/scripts/test-runtime/environment/vitest-real-agent-home-write-guard.ts',
  'config/scripts/test-runtime/environment/vitest-bun-node-builtins.ts',
  'config/scripts/test-runtime/dom/vitest-dom-setup.ts',
  'config/scripts/test-runtime/environment/vitest-host-ports-setup.ts',
  'config/scripts/test-runtime/environment/vitest-caller-identity-env-setup.ts',
  'config/scripts/test-runtime/environment/vitest-inherited-git-env-setup.ts',
  'config/scripts/test-runtime/environment/vitest-orcad-feature-readiness-reset.ts'
]

// Ordinary local Vitest runs use defaultExclude. These additional exclusions apply to balanced runs.
export const UNIT_EXCLUDE = [
  ...defaultExclude,
  'src/main/daemon/shell-readiness/testing/repro-13767-shell-ready-marker-lost-to-exec.test.ts',
  'src/main/daemon/shell-readiness/testing/shell-ready.test.ts',
  'src/main/daemon/pty-subprocess/testing/node-pty-fd-leak.test.ts',
  'src/main/providers/local-pty/local-pty-shell-ready-zsh-launch-environment.test.ts',
  'src/main/pty/shell-startup/omp-shell-wrapper-alias-safety.test.ts',
  'src/main/pty/shell-startup/omp-shell-wrapper.node-pty.test.ts',
  'src/main/pty/history/terminal-history-fish-session.node-pty.test.ts',
  'src/main/pty/shell-startup/zsh-scoped-histfile.live-shell.test.ts',
  'src/main/pty/shell-startup/zsh-startup-hook-user-config-equivalence.live-shell.test.ts',
  'src/main/startup/shell-probe-terminal-detach.live-shell.test.ts',
  'src/main/startup/shell-probe-lifetime.live-shell.test.ts',
  'src/renderer/src/components/terminal-pane/fish-color-scheme-child-stdin.node-pty.test.ts',
  'src/shared/terminal/pty/ingress/pty-reply-echo-shapes.node-pty.test.ts'
]

export function discoverUnitFiles(root = process.cwd()) {
  return globSync(UNIT_INCLUDE, { cwd: root, exclude: UNIT_EXCLUDE })
    .map((file) => file.replaceAll('\\', '/'))
    .sort()
}
