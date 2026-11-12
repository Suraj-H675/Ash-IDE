import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { getTrustedUIRendererWebContents } from '../ui'

// Remote-development targets were removed from Ash. A host-local account
// choice must never be silently reinterpreted as a WSL or SSH login.
export const HostAccountTargetSchema = z
  .object({ runtime: z.literal('host').optional(), wslDistro: z.null().optional() })
  .strict()

const AccountIdSchema = z.string().min(1).max(256)

export const HostAccountSelectionSchema = HostAccountTargetSchema.extend({
  accountId: AccountIdSchema.nullable()
})

export const AccountIdRequestSchema = z.object({ accountId: AccountIdSchema }).strict()

export const CodexReauthenticationSchema = AccountIdRequestSchema.extend({
  activateIfSelectionWasEmpty: z.boolean().optional()
})

export const ClaudeReauthenticationSchema = AccountIdRequestSchema.extend({
  copyLink: z.boolean().optional()
})

export const ClaudeAddRequestSchema = HostAccountTargetSchema.extend({
  copyLink: z.boolean().optional()
})

export const PaneIdsRequestSchema = z
  .object({ ptyIds: z.array(z.string().min(1).max(512)).max(256) })
  .strict()

/** Only the trusted Ash application UI can request provider-native account actions. */
export function handleAshNativeAccountIpc<Args extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => Result
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (getTrustedUIRendererWebContents() !== event.sender) {
      throw new Error('Unauthorized provider account IPC sender')
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the Electron IPC variadic tuple is forwarded unchanged; every registered account handler validates its payload before use.
    return listener(event, ...(args as Args))
  })
}
