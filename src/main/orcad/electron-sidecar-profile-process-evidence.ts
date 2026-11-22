import { runProcess } from '@orca/process-host'
import { readWindowsProcessRowsForProfileRecovery } from '../windows/windows-process-table-cim-scan'
import type { WindowsProcessRow } from '../windows/windows-process-table'
import { psLocaleEnvironment } from '../../shared/ps-locale-environment'

const PROCESS_SCAN_TIMEOUT_MS = 5_000
const PROCESS_SCAN_MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const KNOWN_ELECTRON_PROCESS_NAMES = new Set([
  'ash.exe',
  'chrome.exe',
  'chromium.exe',
  'electron.exe',
  'msedge.exe',
  'orca.exe'
])

export type SidecarProfileUse = 'in-use' | 'absent' | 'unknown'

/** A path match is positive evidence even if the process table was truncated after that row. */
export function classifyPosixProcessSnapshot(
  stdout: string,
  profilePath: string
): SidecarProfileUse {
  if (stdout.includes(profilePath)) {
    return 'in-use'
  }
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) {
    return 'unknown'
  }
  for (const line of lines) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)
    const pid = match ? Number(match[1]) : Number.NaN
    if (!match || !Number.isSafeInteger(pid) || pid <= 0 || !match[2]) {
      return 'unknown'
    }
  }
  return 'absent'
}

/** Unreadable command lines for the expected app or a known browser process stay unknown. */
export function classifyWindowsProcessRows(
  rows: readonly WindowsProcessRow[],
  profilePath: string,
  sidecarExecutableName?: string
): SidecarProfileUse {
  if (rows.some((row) => row.command.toLowerCase().includes(profilePath.toLowerCase()))) {
    return 'in-use'
  }
  if (rows.length === 0) {
    return 'unknown'
  }
  const candidates = new Set(KNOWN_ELECTRON_PROCESS_NAMES)
  if (sidecarExecutableName) {
    candidates.add(sidecarExecutableName.toLowerCase())
  }
  if (
    rows.some(
      (row) =>
        candidates.has(row.name.toLowerCase()) &&
        row.command.trim().toLowerCase() === row.name.trim().toLowerCase()
    )
  ) {
    return 'unknown'
  }
  return 'absent'
}

/** Read-only bounded snapshot; no PID from this result is ever signaled. */
export async function readSidecarProfileUse(
  profilePath: string,
  sidecarExecutableName?: string
): Promise<SidecarProfileUse> {
  if (process.platform === 'win32') {
    try {
      return classifyWindowsProcessRows(
        await readWindowsProcessRowsForProfileRecovery(),
        profilePath,
        sidecarExecutableName
      )
    } catch {
      return 'unknown'
    }
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    return 'unknown'
  }
  try {
    const result = await runProcess({
      program: 'ps',
      args: ['-ww', '-axo', 'pid=,command='],
      env: psLocaleEnvironment(),
      timeoutMs: PROCESS_SCAN_TIMEOUT_MS,
      maxOutputBytes: PROCESS_SCAN_MAX_OUTPUT_BYTES
    })
    if (
      result.timedOut ||
      result.code !== 0 ||
      result.signal !== null ||
      result.outputTruncated ||
      result.stderr.length > 0
    ) {
      // Preserve on an error; a positive marker in a partial snapshot is still enough to preserve.
      return result.stdout.includes(profilePath) ? 'in-use' : 'unknown'
    }
    return classifyPosixProcessSnapshot(result.stdout, profilePath)
  } catch {
    return 'unknown'
  }
}
