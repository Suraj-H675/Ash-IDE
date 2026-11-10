import type { SpeechApi } from '../../../preload/api/speech-api'

/**
 * Fail-closed compatibility boundary for unmounted upstream voice modules.
 * Ash does not expose speech in its desktop preload or launch a speech worker.
 * These legacy modules must never silently start browser microphone capture.
 */
export function requireLegacySpeechApi(): SpeechApi {
  const api = window.api.speech
  if (!api) {
    throw new Error('Speech and dictation are not available in Ash IDE')
  }
  return api
}
