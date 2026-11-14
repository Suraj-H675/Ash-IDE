import { spawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

const NOTIFY_SEND_PATH = '/usr/bin/notify-send'
const NOTIFY_SEND_TIMEOUT_MS = 3_000

type SpawnNotification = (
  file: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess

export type WindowlessLinuxNotifierDeps = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  spawnProcess: SpawnNotification
}

/**
 * The persistent Node runtime cannot use Electron's Notification API after the
 * last GUI closes. On Linux, ask the user's existing local notification daemon
 * over the session D-Bus, without a shell, socket listener or vendor service.
 * A missing bus/helper is an unsupported delivery, not a fabricated success.
 */
export function createWindowlessLinuxAgentNotifier(deps: WindowlessLinuxNotifierDeps) {
  return async (input: { title: string; body: string }): Promise<boolean> => {
    const bus = deps.env.DBUS_SESSION_BUS_ADDRESS
    if (deps.platform !== 'linux' || !bus || !input.title.trim()) {
      return false
    }

    // No agent/provider credentials or arbitrary PATH are inherited by a
    // distribution helper. Arguments are literal, never interpreted as shell.
    const env: NodeJS.ProcessEnv = {
      DBUS_SESSION_BUS_ADDRESS: bus,
      ...(deps.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: deps.env.XDG_RUNTIME_DIR } : {}),
      ...(deps.env.DISPLAY ? { DISPLAY: deps.env.DISPLAY } : {}),
      ...(deps.env.WAYLAND_DISPLAY ? { WAYLAND_DISPLAY: deps.env.WAYLAND_DISPLAY } : {}),
      ...(deps.env.HOME ? { HOME: deps.env.HOME } : {}),
      ...(deps.env.LANG ? { LANG: deps.env.LANG } : {})
    }
    let child: ChildProcess
    try {
      child = deps.spawnProcess(
        NOTIFY_SEND_PATH,
        [
          '--app-name=Ash IDE',
          '--urgency=normal',
          '--expire-time=8000',
          '--',
          input.title.slice(0, 256),
          input.body.slice(0, 4096)
        ],
        { env, stdio: 'ignore', windowsHide: true }
      )
    } catch {
      return false
    }

    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (delivered: boolean) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(delivered)
      }
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // A helper that exited during timeout cleanup needs no more work.
        }
        finish(false)
      }, NOTIFY_SEND_TIMEOUT_MS)
      timer.unref?.()
      child.once('error', () => finish(false))
      child.once('close', (code) => finish(code === 0))
    })
  }
}

export const notifyWindowlessLinuxAgent = createWindowlessLinuxAgentNotifier({
  platform: process.platform,
  env: process.env,
  spawnProcess: (file, args, options) => spawn(file, [...args], options)
})
