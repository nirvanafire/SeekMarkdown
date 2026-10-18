import type { ButtonHTMLAttributes } from 'react'

export type NeuButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type NeuButtonSize = 'sm' | 'md'

export interface NeuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NeuButtonVariant
  size?: NeuButtonSize
  pressed?: boolean
}

export default function NeuButton({
  variant = 'secondary',
  size = 'md',
  pressed,
  className,
  type = 'button',
  children,
  ...props
}: NeuButtonProps): JSX.Element {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      data-pressed={pressed ? 'true' : undefined}
      className={[
        'neu-button',
        `neu-button--${variant}`,
        `neu-button--${size}`,
        pressed ? 'is-pressed' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </button>
  )
}
