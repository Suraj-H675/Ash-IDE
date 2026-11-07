import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

export const SERVE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['serve'],
    summary: 'Start Ash’s authenticated local runtime without opening a desktop window',
    usage: 'ash-ide serve [--supervise] [--force] [--reclaim-stale-lock [--data-root <dir>] [--yes]] [--json]',
    allowedFlags: [
      ...LOCAL_COMMAND_FLAGS,
      'supervise',
      'force',
      'reclaim-stale-lock',
      'data-root',
      'yes'
    ],
    notes: [
      'Runs in the foreground over Ash’s authenticated local transport and prints local runtime readiness. It does not open a network control listener. Stop it with Ctrl+C.',
      'Exits with code 3 without starting another host when Ash already serves this profile or the existing host cannot be shown to have stopped.',
      "--reclaim-stale-lock starts nothing. When a start refuses because this profile's lock may be stale, it checks the local host and boot evidence before reporting what it found. Add --yes only after reviewing that evidence to clear an eligible lock. It exits 1 when a check fails and 4 when no lock exists. --data-root names the data root the refusal printed. --json prints the result. Linux only.",
      'On macOS, after Ash serve aborts at startup because it could not register with Launch Services, later runs from the same environment refuse for 30 minutes with exit code 78. Use --force to try again.',
      '--supervise is for service managers (launchd, systemd). Ash restarts the local runtime with growing delays, waits while an install replaces the app, and stops after repeated failures. It is not available on Windows yet.',
      'The local terminal daemon remains independent of this Ash runtime process and keeps live terminals running if the runtime exits.'
    ],
    examples: [
      'ash-ide serve',
      'ash-ide serve --json',
      'ash-ide serve --supervise',
      'ash-ide serve --reclaim-stale-lock'
    ]
  },
  {
    path: ['serve', 'restore', 'resume'],
    summary: 'Resume automatic terminal restores that this host paused',
    usage: 'ash-ide serve restore resume [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'After its terminal host stops unexpectedly, or while it is overloaded, Ash keeps restored agent sessions asleep instead of starting them all at once. Each one resumes when you open it.',
      'This clears that pause so automatic restores start again, within the normal limits. It talks to Ash running on this machine and never starts another runtime.',
      'It also lists restores from an older Ash client that this host refused, with the command that resumes each one.'
    ],
    examples: ['ash-ide serve restore resume', 'ash-ide serve restore resume --json']
  },
  {
    path: ['serve', 'service', 'install'],
    summary: 'Run the Ash local runtime as a per-user background service that restarts itself',
    usage:
      'ash-ide serve service install [--command <path>] [--dry-run] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'command', 'dry-run'],
    notes: [
      'macOS writes a LaunchAgent; Linux writes a systemd user unit. Both run `ash-ide serve --supervise` for this profile, so the local runtime restarts with growing delays and gives up after repeated failures instead of looping.',
      'On Linux the service stops at logout unless lingering is on (`loginctl enable-linger`); install reports it.',
      "Reinstalling replaces the unit and clears a previous give-up. --command defaults to the installed Ash app's `ash-ide` command on PATH and must not be tied to one app version. --dry-run prints the unit without installing it.",
      'Needs Ash installed on this machine.',
      'Not available on Windows yet.'
    ],
    examples: ['ash-ide serve service install', 'ash-ide serve service install --dry-run']
  },
  {
    path: ['serve', 'service', 'status'],
    summary: "Show whether this profile's Ash serve service is running",
    usage: 'ash-ide serve service status [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Reports live, exited, or unverifiable (when the service manager cannot be asked), plus why the supervisor gave up if it did.'
    ],
    examples: ['ash-ide serve service status', 'ash-ide serve service status --json']
  },
  {
    path: ['serve', 'service', 'uninstall'],
    summary: "Stop and remove this profile's Ash serve service",
    usage: 'ash-ide serve service uninstall [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Stops the service and removes its unit file. The terminal daemon and its sessions keep running.'
    ],
    examples: ['ash-ide serve service uninstall']
  }
]
