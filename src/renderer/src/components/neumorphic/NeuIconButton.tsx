import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface NeuIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  pressed?: boolean
  children: ReactNode
}

export default function NeuIconButton({
  label,
  pressed,
  className,
  type = 'button',
  title,
  children,
  ...props
}: NeuIconButtonProps): JSX.Element {
  return (
    <button
      type={type}
      title={title ?? label}
      aria-label={label}
      aria-pressed={pressed}
      data-pressed={pressed ? 'true' : undefined}
      className={['neu-icon-button', pressed ? 'is-pressed' : '', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </button>
  )
}
