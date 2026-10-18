import type { ButtonHTMLAttributes } from 'react'

export interface NeuToggleProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  description?: string
}

export default function NeuToggle({
  checked,
  onCheckedChange,
  label,
  description,
  className,
  disabled,
  ...props
}: NeuToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={['neu-toggle', checked ? 'is-on' : '', className].filter(Boolean).join(' ')}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span className="neu-toggle__control" aria-hidden="true">
        <span className="neu-toggle__thumb" />
      </span>
      <span className="neu-toggle__copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </button>
  )
}
