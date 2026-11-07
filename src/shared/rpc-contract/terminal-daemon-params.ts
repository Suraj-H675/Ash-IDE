import { z } from 'zod'

export const TerminalDaemonRestartSeveredParams = z.object({
  pid: z.number().int().positive(),
  linuxStartTicks: z.string().min(1).max(32),
  bootId: z.string().min(1).max(64)
})

export const TerminalDaemonStopSession = z.object({
  sessionId: z.string().min(1).max(128),
  incarnationId: z.string().min(1).max(128),
  pid: z.number().int().positive(),
  createdAt: z.number().finite().nonnegative(),
  cwd: z.string().nullable(),
  foregroundProcess: z.string().nullable()
})

export const TerminalDaemonStopParams = z.object({
  confirmed: z.literal(true),
  expectedIdentity: z.object({
    pid: z.number().int().positive(),
    // Linux process-incarnation evidence can include fractional milliseconds.
    // Reject non-finite/negative values, but retain the exact observed time.
    startedAtMs: z.number().finite().nonnegative(),
    launchNonce: z.string().min(1).max(128)
  }),
  expectedSessions: z.array(TerminalDaemonStopSession).max(512),
  mode: z.enum(['graceful', 'force'])
})
