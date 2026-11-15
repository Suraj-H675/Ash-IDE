import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSpeechModelManager, setSpeechServiceFactories } from '../speech/speech-runtime-service'
import { installOrcadHostAdapters } from './orcad-host-adapters'

afterEach(() => {
  // The factory slot is module-local. Never let a synthetic test factory leak
  // into a later test, or permit a real model download/native recognizer.
  setSpeechServiceFactories(null)
})

describe('Ash local orcad voice/dictation exclusion', () => {
  it('clears inherited speech factories when installing local runtime adapters', () => {
    const fakeFactory = vi.fn()
    setSpeechServiceFactories({
      createModelManager: fakeFactory,
      createSttService: vi.fn()
    } as unknown as Parameters<typeof setSpeechServiceFactories>[0])

    installOrcadHostAdapters()

    expect(() => getSpeechModelManager({ getSettings: () => ({}) })).toThrow(
      'speech_unavailable: this host has no speech services'
    )
    expect(fakeFactory).not.toHaveBeenCalled()
  })
})
