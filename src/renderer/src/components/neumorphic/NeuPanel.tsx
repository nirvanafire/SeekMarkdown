import type { ElementType, HTMLAttributes } from 'react'

export type NeuSurface = 'raised' | 'inset' | 'flush'

export interface NeuPanelProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType
  surface?: NeuSurface
}

export default function NeuPanel({
  as,
  surface = 'raised',
  className,
  children,
  ...props
}: NeuPanelProps): JSX.Element {
  const Tag = as ?? 'div'

  return (
    <Tag
      className={['neu-panel', `neu-panel--${surface}`, className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </Tag>
  )
}
