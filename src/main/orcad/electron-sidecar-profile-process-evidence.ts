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

export type SidecarProfileUse = 'in-use' | 'absent' | 'unknown' | 'unavailable'

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

/** Any unreadable process command line keeps a Windows ownership census unknown. */
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
  if (rows.some((row) => row.commandLineReadable === false)) {
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
export async function readWindowsSidecarProfileUse(
  profilePath: string,
  sidecarExecutableName?: string,
  readRows: typeof readWindowsProcessRowsForProfileRecovery = readWindowsProcessRowsForProfileRecovery
): Promise<SidecarProfileUse> {
  try {
    return classifyWindowsProcessRows(await readRows(), profilePath, sidecarExecutableName)
  } catch {
    return 'unavailable'
  }
}

export async function readSidecarProfileUse(
  profilePath: string,
  sidecarExecutableName?: string
): Promise<SidecarProfileUse> {
  if (process.platform === 'win32') {
    return readWindowsSidecarProfileUse(profilePath, sidecarExecutableName)
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    return 'unavailable'
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
      return result.stdout.includes(profilePath) ? 'in-use' : 'unavailable'
    }
    return classifyPosixProcessSnapshot(result.stdout, profilePath)
  } catch {
    return 'unavailable'
  }
}
