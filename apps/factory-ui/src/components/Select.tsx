import { createContext, useContext } from 'react';
import { Select as UiSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** Dialogs provide their panel here so a listbox renders inside the dialog and its focus trap leaves it alone. */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  'aria-label'?: string;
  className?: string;
  autoFocus?: boolean;
};

// Radix forbids an item with the value ''; the UI uses '' for "all" or "none".
const EMPTY_VALUE = '__select_empty__';

export function Select({ id, value, onValueChange, options, placeholder, disabled, required, name, 'aria-label': ariaLabel, className, autoFocus }: SelectProps) {
  const container = useContext(PortalContainerContext);
  const internalValue = value === '' && options.some(option => option.value === '') ? EMPTY_VALUE : value;
  return <UiSelect value={internalValue} onValueChange={next => onValueChange(next === EMPTY_VALUE ? '' : next)} disabled={disabled ?? false} required={required ?? false} {...(name === undefined ? {} : { name })}>
    <SelectTrigger id={id} aria-label={ariaLabel} autoFocus={autoFocus ?? false} className={cn('w-full', className)}>
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent position="popper" sideOffset={6} collisionPadding={12} container={container} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
      {options.map(option => <SelectItem key={option.value === '' ? EMPTY_VALUE : option.value} value={option.value === '' ? EMPTY_VALUE : option.value} disabled={option.disabled ?? false}>{option.label}</SelectItem>)}
    </SelectContent>
  </UiSelect>;
}
