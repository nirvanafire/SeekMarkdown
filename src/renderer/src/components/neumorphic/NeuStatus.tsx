export type NeuStatusTone = 'idle' | 'saving' | 'saved' | 'dirty' | 'error'

export interface NeuStatusProps {
  tone?: NeuStatusTone
  label: string
  compact?: boolean
  className?: string
}

export default function NeuStatus({
  tone = 'idle',
  label,
  compact = false,
  className
}: NeuStatusProps): JSX.Element {
  return (
    <span
      className={[
        'neu-status',
        `neu-status--${tone}`,
        compact ? 'neu-status--compact' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      data-tone={tone}
      aria-label={label}
    >
      <i aria-hidden="true" />
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </span>
  )
}
