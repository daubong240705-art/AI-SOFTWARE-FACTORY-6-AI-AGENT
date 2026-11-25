import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './select';

const emptyOption = 'choice:empty';

type OptionProps = { value: string | number; disabled?: boolean; children: ReactNode };

export function ChoiceOption({ value, children, disabled }: OptionProps) {
  return <SelectItem value={value === '' ? emptyOption : String(value)} disabled={disabled}>{children}</SelectItem>;
}

export function ChoiceGroup({ label, children }: { label: string; children: ReactNode }) {
  return <SelectGroup><SelectLabel>{label}</SelectLabel>{children}</SelectGroup>;
}

type ChoiceProps = Omit<ComponentProps<typeof SelectTrigger>, 'value' | 'defaultValue' | 'onChange'> & {
  value: string | number;
  onValueChange: (value: string) => void;
  name?: string;
  form?: string;
  required?: boolean;
};

export function Choice({ value, onValueChange, name, form, required, disabled, className, children, ...trigger }: ChoiceProps) {
  const placeholder = Children.toArray(children).find(item => isValidElement<OptionProps>(item) && item.type === ChoiceOption && item.props.value === '');
  return <Select value={String(value)} onValueChange={next => onValueChange(next === emptyOption ? '' : next)} name={name} form={form} required={required} disabled={disabled}>
    <SelectTrigger className={cn('w-full min-w-0 max-w-full text-left [&+select[aria-hidden=true]:not(:required)]:invisible', className)} {...trigger}>
      <SelectValue placeholder={isValidElement<OptionProps>(placeholder) ? placeholder.props.children : '—'} />
    </SelectTrigger>
    <SelectContent position="popper">{children}</SelectContent>
  </Select>;
}
