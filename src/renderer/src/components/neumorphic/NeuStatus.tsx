export type NeuStatusTone = 'idle' | 'saving' | 'saved' | 'dirty' | 'error'

export interface NeuStatusProps {
  tone?: NeuStatusTone
  label: string
  className?: string
}

export default function NeuStatus({
  tone = 'idle',
  label,
  className
}: NeuStatusProps): JSX.Element {
  return (
    <span
      className={['neu-status', `neu-status--${tone}`, className].filter(Boolean).join(' ')}
      data-tone={tone}
    >
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
