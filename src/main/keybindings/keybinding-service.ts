import {
  LEGACY_TAB_SWITCH_BINDINGS,
  type KeybindingActionId,
  type KeybindingFileSnapshot,
  type KeybindingOverrides
} from '../../shared/keybindings'
import {
  ensureKeybindingFile,
  getUserKeybindingsPath,
  migrateLegacyKeybindings,
  readKeybindingFile,
  seedLegacyTabSwitchBindings,
  writeKeybindingOverride
} from './keybinding-file'

export type KeybindingServiceOptions = {
  userDataPath: string
  homePath?: string
  platform?: NodeJS.Platform
  getLegacyOverrides?: () => KeybindingOverrides | undefined
  /** Seed once for pre-existing installs; markSeeded completes the persisted cohort. */
  legacyTabSwitchSeed?: {
    isPending: () => boolean
    markSeeded: () => void
  }
}

export class KeybindingService {
  private readonly configPath: string
  private readonly userDataPath: string
  private readonly homePath: string | undefined
  private readonly platform: NodeJS.Platform
  private snapshot: KeybindingFileSnapshot | null = null

  constructor(options: KeybindingServiceOptions) {
    this.userDataPath = options.userDataPath
    this.homePath = options.homePath
    this.configPath = getUserKeybindingsPath(this.userDataPath, this.homePath)
    this.platform = options.platform ?? process.platform
    // A keybindings file supersedes shortcuts stored in legacy global settings.
    migrateLegacyKeybindings(this.configPath, this.platform, options.getLegacyOverrides?.())
    // Complete the cohort only after successful pinning so transient I/O failures retry next launch.
    if (options.legacyTabSwitchSeed?.isPending()) {
      try {
        // Seed already read the file; reuse its snapshot for the lazy cache.
        this.snapshot = seedLegacyTabSwitchBindings(
          this.configPath,
          this.platform,
          LEGACY_TAB_SWITCH_BINDINGS
        ).snapshot
        options.legacyTabSwitchSeed.markSeeded()
      } catch (error) {
        console.error('Failed to seed legacy tab-switch keybindings:', error)
      }
    }
  }

  getPath(): string {
    this.ensureSafePath()
    return this.configPath
  }

  private ensureSafePath(): void {
    // A once-safe profile or keybindings file could have become a symlink
    // since startup; validate before every cached read or mutation.
    getUserKeybindingsPath(this.userDataPath, this.homePath)
  }

  getSnapshot(): KeybindingFileSnapshot {
    this.ensureSafePath()
    if (!this.snapshot) {
      this.snapshot = readKeybindingFile(this.configPath, this.platform)
    }
    return this.snapshot
  }

  reload(): KeybindingFileSnapshot {
    this.ensureSafePath()
    this.snapshot = readKeybindingFile(this.configPath, this.platform)
    return this.snapshot
  }

  getOverrides(): KeybindingOverrides {
    return this.getSnapshot().overrides
  }

  ensureFile(): KeybindingFileSnapshot {
    this.ensureSafePath()
    ensureKeybindingFile(this.configPath)
    return this.reload()
  }

  setActionBindings(
    actionId: KeybindingActionId,
    bindings: string[] | null
  ): KeybindingFileSnapshot {
    this.ensureSafePath()
    this.snapshot = writeKeybindingOverride(this.configPath, this.platform, actionId, bindings)
    return this.snapshot
  }
}
