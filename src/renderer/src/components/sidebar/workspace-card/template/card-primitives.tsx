import React from 'react'
import { CircleDashed } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { resolveCardIconGlyph } from './card-icon-glyphs'
import { cn } from '@/lib/utils'
import { cardElement, type CardHostElement } from './card-template-compiler'

const GAP: Readonly<Record<string, string>> = {
  xs: 'gap-0.5',
  sm: 'gap-1',
  md: 'gap-1.5',
  lg: 'gap-2'
}
const ALIGN: Readonly<Record<string, string>> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end'
}
const JUSTIFY: Readonly<Record<string, string>> = {
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between'
}
const OVERFLOW: Readonly<Record<string, string>> = {
  clip: 'overflow-hidden',
  visible: 'overflow-visible'
}
// Markers Orca's own code and tests select on; a template may only reuse these.
const MARKERS: Readonly<Record<string, string>> = {
  'parent-content': 'data-worktree-card-parent-content',
  'meta-row': 'data-worktree-card-meta-row',
  'hover-trigger': 'data-worktree-card-hover-trigger'
}

const BOX_PROPS = [
  'gap',
  'align',
  'justify',
  'fill',
  'grow',
  'keep',
  'push',
  'inset',
  'overflow',
  'hoverGroup',
  'marker'
] as const

function pick(map: Readonly<Record<string, string>>, value: unknown): string | undefined {
  return typeof value === 'string' && Object.hasOwn(map, value) ? map[value] : undefined
}

function boxAttrs(
  props: Readonly<Record<string, unknown>>,
  column: boolean
): Record<string, unknown> {
  const marker = pick(MARKERS, props.marker)
  return {
    className: cn(
      'flex',
      // A box that keeps its size never needs to shrink below its content.
      props.keep !== true && 'min-w-0',
      column && 'flex-col',
      pick(GAP, props.gap),
      pick(ALIGN, props.align),
      pick(JUSTIFY, props.justify),
      props.fill === true && 'w-full',
      props.grow === true && 'flex-1',
      props.keep === true && 'shrink-0',
      props.push === true && 'ml-auto',
      props.inset === 'end' && 'pr-1.5',
      pick(OVERFLOW, props.overflow),
      props.hoverGroup === true && 'group/worktree-card'
    ),
    ...(marker ? { [marker]: '' } : {})
  }
}

export const Row: CardHostElement = {
  kind: 'host',
  props: BOX_PROPS,
  resolve: (props) => ({ tag: 'div', attrs: boxAttrs(props, false) })
}

export const Stack: CardHostElement = {
  kind: 'host',
  props: BOX_PROPS,
  resolve: (props) => ({ tag: 'div', attrs: boxAttrs(props, true) })
}

const TEXT_SIZE: Readonly<Record<string, string>> = {
  title: 'text-[13px] leading-5',
  body: 'text-xs',
  meta: 'text-2xs leading-none',
  micro: 'text-3xs leading-none'
}
const TONE: Readonly<Record<string, string>> = {
  neutral: 'text-foreground',
  accent: 'text-primary',
  success: 'text-status-success',
  warning: 'text-status-warning-text',
  danger: 'text-destructive'
}
const BADGE_TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const

/** Badge tone: success and warning have no badge colour, so they carry a status dot. */
function CardBadge({
  tone,
  children
}: {
  tone: (typeof BADGE_TONES)[number] | undefined
  children: React.ReactNode
}): React.JSX.Element {
  switch (tone) {
    case 'accent':
      return <Badge variant="default">{children}</Badge>
    case 'danger':
      return <Badge variant="destructive">{children}</Badge>
    case 'success':
      return (
        <Badge variant="outline">
          <span aria-hidden className="size-1.5 rounded-full bg-status-success" />
          {children}
        </Badge>
      )
    case 'warning':
      return (
        <Badge variant="outline">
          <span aria-hidden className="size-1.5 rounded-full bg-status-warning" />
          {children}
        </Badge>
      )
    case 'neutral':
    case undefined:
      return <Badge variant="secondary">{children}</Badge>
  }
}

function toText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

type Props = Readonly<Record<string, unknown>>

function text(props: Props): React.ReactNode {
  return (
    <span
      className={cn(
        'min-w-0',
        pick(TEXT_SIZE, props.size) ?? TEXT_SIZE.body,
        props.muted === true ? 'text-muted-foreground' : (pick(TONE, props.tone) ?? TONE.neutral),
        props.weight === 'medium' && 'font-medium',
        props.weight === 'semibold' && 'font-semibold',
        props.mono === true && 'font-mono',
        props.truncate === true && 'truncate'
      )}
    >
      {toText(props.text)}
    </span>
  )
}

function badge(props: Props): React.ReactNode {
  const tone = BADGE_TONES.find((candidate) => candidate === props.tone)
  return <CardBadge tone={tone}>{toText(props.text)}</CardBadge>
}

function icon(props: Props): React.ReactNode {
  return React.createElement(resolveCardIconGlyph(toText(props.name), CircleDashed), {
    className: cn('size-3 shrink-0', pick(TONE, props.tone) ?? 'text-muted-foreground')
  })
}

/** Primitives draw from props alone, so they work under any context. */
export const CARD_PRIMITIVES = {
  Row,
  Stack,
  Text: cardElement<unknown>(['text', 'size', 'tone', 'muted', 'weight', 'mono', 'truncate'], text),
  Badge: cardElement<unknown>(['text', 'tone'], badge),
  Icon: cardElement<unknown>(['name', 'tone'], icon)
}
