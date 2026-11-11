import { useId, type ComponentProps, type ReactNode } from 'react';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';

export function FormField({ label, help, children }: { label: string; help: string; children: (id: string, helpId: string) => ReactNode }) {
  const id = useId();
  return <Field className="gap-2"><FieldLabel htmlFor={id}>{label}</FieldLabel>{children(id, `${id}-help`)}<FieldDescription id={`${id}-help`} className="text-xs">{help}</FieldDescription></Field>;
}
export function TextField({ label, help, ...props }: ComponentProps<typeof Input> & { label: string; help: string }) {
  return <FormField label={label} help={help}>{(id, helpId) => <Input {...props} id={id} aria-describedby={helpId} />}</FormField>;
}
export function EnabledField({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const t = useT(); const id = useId();
  return <Field orientation="horizontal" className="justify-between rounded-lg border border-border p-3"><div className="space-y-1"><FieldLabel htmlFor={id}>{t('automationWrite.enabled')}</FieldLabel><FieldDescription id={`${id}-help`} className="text-xs">{t('automationWrite.enabledHelp')}</FieldDescription></div><Switch id={id} checked={value} onCheckedChange={onChange} aria-describedby={`${id}-help`} /></Field>;
}
