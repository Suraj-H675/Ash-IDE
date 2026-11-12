import type { CodexAccountService } from '../codex-accounts/service'
import { broadcastCodexPendingLoginUrl } from './codex-pending-login-url-broadcast'
import { listRecordedCodexPaneLanes } from '../codex/configuration/homes/codex-pane-account-registry'
import {
  forgetStaleCodexPanes,
  listStaleCodexPanes
} from '../codex/configuration/homes/codex-stale-pane-accounts'
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  AccountIdRequestSchema,
  CodexReauthenticationSchema,
  handleAshNativeAccountIpc,
  HostAccountSelectionSchema,
  HostAccountTargetSchema,
  PaneIdsRequestSchema
} from './provider-accounts/ash-native-account-ipc'

export function registerCodexAccountHandlers(
  codexAccounts: CodexAccountService,
  getSettings?: () => GlobalSettings
): void {
  handleAshNativeAccountIpc('codexAccounts:listStalePanes', (_event, value: unknown) => {
    const { ptyIds } = PaneIdsRequestSchema.parse(value)
    const settings = getSettings?.()
    if (!settings) {
      return []
    }
    return listStaleCodexPanes({
      ptyIds,
      settings
    })
  })
  handleAshNativeAccountIpc('codexAccounts:listRecordedPaneLanes', (_event, value: unknown) => {
    return listRecordedCodexPaneLanes(PaneIdsRequestSchema.parse(value).ptyIds)
  })
  handleAshNativeAccountIpc('codexAccounts:forgetStalePanes', (_event, value: unknown) => {
    forgetStaleCodexPanes(PaneIdsRequestSchema.parse(value).ptyIds)
  })
  handleAshNativeAccountIpc('codexAccounts:list', () => codexAccounts.listAccounts())
  handleAshNativeAccountIpc('codexAccounts:add', (_event, value?: unknown) =>
    codexAccounts.addAccount(HostAccountTargetSchema.parse(value ?? {}))
  )
  handleAshNativeAccountIpc('codexAccounts:cancelPendingLogin', () =>
    codexAccounts.cancelPendingLogin()
  )
  handleAshNativeAccountIpc('codexAccounts:pendingLoginUrl', () =>
    codexAccounts.getPendingLoginUrl()
  )
  // Settings reads the current link on mount; broadcasts carry later changes.
  codexAccounts.onPendingLoginUrlChanged(broadcastCodexPendingLoginUrl)
  handleAshNativeAccountIpc('codexAccounts:reauthenticate', (_event, value: unknown) => {
    const args = CodexReauthenticationSchema.parse(value)
    return codexAccounts.reauthenticateAccount(args.accountId, {
      activateIfSelectionWasEmpty: args.activateIfSelectionWasEmpty === true
    })
  })
  handleAshNativeAccountIpc('codexAccounts:remove', (_event, value: unknown) =>
    codexAccounts.removeAccount(AccountIdRequestSchema.parse(value).accountId)
  )
  handleAshNativeAccountIpc('codexAccounts:select', (_event, value: unknown) => {
    const args = HostAccountSelectionSchema.parse(value)
    // Older renderers omit the target; never infer a removed WSL lane
    // from a managed account ID at this host-local desktop boundary.
    return codexAccounts.selectAccountForTarget(args.accountId, { runtime: 'host' })
  })
}
