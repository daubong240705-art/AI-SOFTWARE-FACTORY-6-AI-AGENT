import type { ButtonHTMLAttributes } from 'react';

export function Button({ variant = 'default', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'accent' | 'default' }) {
  return <button {...props} type={type} className={`button ${variant} ${className}`} />;
}
