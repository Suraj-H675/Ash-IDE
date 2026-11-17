import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { primarySparse } from '../identity/WorktreeCardIdentity.fixture'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'

const initialStore = useAppStore.getState()

afterEach(() => useAppStore.setState(initialStore, true))

describe('retained workspace card rendering', () => {
  it('renders the real card fixture through its built-in template and primitives', () => {
    useAppStore.setState(primarySparse.store ?? {})

    const html = renderToStaticMarkup(<TooltipProvider>{primarySparse.render()}</TooltipProvider>)

    expect(html).toContain('Primary workspace')
    expect(html).toContain('main')
    expect(html).toContain('data-worktree-card-parent-content')
  })
})
