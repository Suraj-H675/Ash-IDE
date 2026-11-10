import { useEffect } from 'react'
import { handleAutomationDispatchRequest } from './automation-dispatch-handler'
import { requireLegacyAutomationsApi } from '@/lib/require-legacy-automations-api'

export function useAutomationDispatchEvents(): void {
  useEffect(() => {
    const automationsApi = requireLegacyAutomationsApi()
    const unsubscribe = automationsApi.onDispatchRequested(handleAutomationDispatchRequest)
    void automationsApi.rendererReady()
    return unsubscribe
  }, [])
}
