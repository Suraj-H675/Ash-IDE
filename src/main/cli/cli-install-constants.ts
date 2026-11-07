export const DEFAULT_MAC_COMMAND_PATH = '/usr/local/bin/ash-ide'
export const DEV_COMMAND_NAME = 'ash-ide-dev'
// Do not migrate, replace, or remove the installed Orca application's command.
// This legacy identifier only remains for dormant upstream compatibility code.
export const LEGACY_LINUX_COMMAND_NAME = 'orca'
export const DEV_LAUNCHER_DIR = ['cli', 'bin'] as const
// Cold PowerShell start plus the WM_SETTINGCHANGE broadcast exceeded 5 s on low-spec machines.
export const WINDOWS_PATH_WRITE_TIMEOUT_MS = 15_000
