import { create } from 'zustand'

/** English resources are bundled locally, so readiness only tracks the provider's language reset. */
export const useLanguageReadiness = create<{ ready: boolean }>()(() => ({ ready: false }))
