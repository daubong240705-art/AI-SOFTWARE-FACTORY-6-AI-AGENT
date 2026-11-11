import { createContext, useContext } from 'react';
import * as RadixSelect from '@radix-ui/react-select';

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

const EMPTY_VALUE = '__select_empty__';

export function Select({ id, value, onValueChange, options, placeholder, disabled, required, name, 'aria-label': ariaLabel, className, autoFocus }: SelectProps) {
  const container = useContext(PortalContainerContext);
  const internalValue = value === '' && options.some(option => option.value === '') ? EMPTY_VALUE : value;
  const classes = ['select-trigger', className].filter(Boolean).join(' ');
  return <RadixSelect.Root value={internalValue} onValueChange={next => onValueChange(next === EMPTY_VALUE ? '' : next)} disabled={disabled} required={required} name={name}>
    <RadixSelect.Trigger id={id} className={classes} aria-label={ariaLabel} autoFocus={autoFocus}>
      <RadixSelect.Value placeholder={placeholder} />
      <RadixSelect.Icon aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m4 6 4 4 4-4" /></svg></RadixSelect.Icon>
    </RadixSelect.Trigger>
    <RadixSelect.Portal container={container}>
      <RadixSelect.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
        <RadixSelect.Viewport className="select-viewport">
          {options.map(option => {
            const itemValue = option.value === '' ? EMPTY_VALUE : option.value;
            return <RadixSelect.Item key={itemValue} value={itemValue} disabled={option.disabled} className="select-item">
              <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              <RadixSelect.ItemIndicator className="select-item-indicator" aria-hidden="true">✓</RadixSelect.ItemIndicator>
            </RadixSelect.Item>;
          })}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  </RadixSelect.Root>;
}

