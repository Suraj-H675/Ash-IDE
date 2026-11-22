import { ProfileStateWriterError } from './profile-state-writer-worker-client'

/** A closed writer cannot be reopened or accept commands. */
export function closedWriterError(): ProfileStateWriterError {
  return new ProfileStateWriterError(
    'profile-state-writer-closed',
    'Profile state writer is closing',
    'known-failure'
  )
}
