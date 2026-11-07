import { join } from 'node:path'

// The Ash executable is independent of both Orca IDE and GNOME's Orca screen reader.
export const LINUX_CLI_COMMAND_NAME = 'ash-ide'

// Keep path-only callers independent of cli-installer's Electron dependency.
export function getBundledLauncherPath(
  platform: NodeJS.Platform,
  resourcesPath: string
): string | null {
  if (platform === 'darwin') {
    return join(resourcesPath, 'bin', 'ash-ide')
  }
  if (platform === 'linux') {
    return join(resourcesPath, 'bin', LINUX_CLI_COMMAND_NAME)
  }
  if (platform === 'win32') {
    return join(resourcesPath, 'bin', 'ash-ide.exe')
  }
  return null
}
