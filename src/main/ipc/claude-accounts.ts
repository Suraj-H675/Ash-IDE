import type { ClaudeAccountService } from '../claude-accounts/service'
import {
  AccountIdRequestSchema,
  ClaudeAddRequestSchema,
  ClaudeReauthenticationSchema,
  handleAshNativeAccountIpc,
  HostAccountSelectionSchema
} from './provider-accounts/ash-native-account-ipc'

export function registerClaudeAccountHandlers(claudeAccounts: ClaudeAccountService): void {
  handleAshNativeAccountIpc('claudeAccounts:list', () => claudeAccounts.listAccounts())
  handleAshNativeAccountIpc('claudeAccounts:add', (_event, value?: unknown) => {
    const args = ClaudeAddRequestSchema.parse(value ?? {})
    return claudeAccounts.addAccount(args, args.copyLink)
  })
  handleAshNativeAccountIpc('claudeAccounts:cancelPendingLogin', () =>
    claudeAccounts.cancelPendingLogin()
  )
  handleAshNativeAccountIpc('claudeAccounts:reauthenticate', (_event, value: unknown) => {
    const args = ClaudeReauthenticationSchema.parse(value)
    return claudeAccounts.reauthenticateAccount(args.accountId, args.copyLink)
  })
  handleAshNativeAccountIpc('claudeAccounts:waitForSignInLink', () =>
    claudeAccounts.waitForSignInLink()
  )
  handleAshNativeAccountIpc('claudeAccounts:remove', (_event, value: unknown) =>
    claudeAccounts.removeAccount(AccountIdRequestSchema.parse(value).accountId)
  )
  handleAshNativeAccountIpc('claudeAccounts:select', (_event, value: unknown) => {
    const args = HostAccountSelectionSchema.parse(value)
    return claudeAccounts.selectAccountForTarget(args.accountId, { runtime: 'host' })
  })
}
