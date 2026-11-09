import type { PtySpawnOptions } from '../pty-provider-contract'

export type LocalPtyShellEntryAttempt = 'primary' | 'fallback'
export type LocalPtyShellEntryPhase = 'before' | 'after'

export type LocalPtyShellEntryObserver = (args: {
  ptyId: string
  incarnationId: string
  phase: LocalPtyShellEntryPhase
  attempt: LocalPtyShellEntryAttempt
  /** Only two allowlisted Claude routing keys, copied and frozen. */
  env: Readonly<Record<string, string>>
}) => void | Promise<void>

const observers = new WeakMap<object, LocalPtyShellEntryObserver>()

/** Private main-process side channel; never part of the spawn request or provider wire shape. */
export function attachLocalPtyShellEntryObserver(
  options: PtySpawnOptions,
  observer: LocalPtyShellEntryObserver
): void {
  observers.set(options, observer)
}

export function takeLocalPtyShellEntryObserver(
  options: PtySpawnOptions
): LocalPtyShellEntryObserver | undefined {
  const observer = observers.get(options)
  observers.delete(options)
  return observer
}
