import { useId, type InputHTMLAttributes } from 'react';

export function Field({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const description = [props['aria-describedby'], error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined;
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <input {...props} id={id} aria-invalid={error ? true : undefined} aria-describedby={description} />
    {error && <span className="field-error" id={`${id}-error`}>{error}</span>}
  </div>;
}
