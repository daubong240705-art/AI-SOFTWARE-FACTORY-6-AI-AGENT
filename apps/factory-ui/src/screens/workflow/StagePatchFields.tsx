import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { stageKeyError } from './stagePatchForms';

export function StageIdentityFields({ id, title, stageKey, onTitle, onKey, used, autoFocus = false }: {
  id: string; title: string; stageKey: string; onTitle: (value: string) => void; onKey: (value: string) => void;
  used: ReadonlySet<string>; autoFocus?: boolean;
}) {
  const t = useT(); const error = stageKeyError(stageKey, used);
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field className="gap-2"><FieldLabel htmlFor={`${id}-title`}>{t('planPatch.stageForm.title')}</FieldLabel>
      <Input id={`${id}-title`} autoFocus={autoFocus} required maxLength={120} value={title} onChange={event => onTitle(event.target.value)} />
      <FieldDescription className="text-xs">{title.length}/120</FieldDescription>
    </Field>
    <Field className="gap-2" data-invalid={!!error}><FieldLabel htmlFor={`${id}-key`}>{t('planPatch.stageForm.key')}</FieldLabel>
      <Input id={`${id}-key`} required maxLength={40} className="font-mono" value={stageKey} onChange={event => onKey(event.target.value)} aria-invalid={!!error} aria-describedby={`${id}-key-help`} />
      <div id={`${id}-key-help`}>{error ? <FieldError>{t(error)}</FieldError> : <FieldDescription className="text-xs">{t('planPatch.stageForm.keyHelp')}</FieldDescription>}</div>
    </Field>
  </div>;
}

const capabilityPattern = /^[a-z0-9][a-z0-9.-]{0,39}$/;
export function CapabilityInput({ id, values, input, onValues, onInput, suggestions }: {
  id: string; values: string[]; input: string; onValues: (values: string[]) => void; onInput: (value: string) => void; suggestions: string[];
}) {
  const t = useT();
  const candidates = input.split(',').map(value => value.trim()).filter(Boolean);
  const invalid = candidates.some(value => !capabilityPattern.test(value));
  const overLimit = new Set([...values, ...candidates]).size > 8;
  function add(raw: string) {
    const parts = raw.split(',').map(value => value.trim()).filter(Boolean);
    if (parts.some(value => !capabilityPattern.test(value)) || new Set([...values, ...parts]).size > 8) { onInput(raw); return; }
    onValues([...new Set([...values, ...parts])]); onInput('');
  }
  return <Field className="gap-2" data-invalid={invalid || overLimit}>
    <FieldLabel htmlFor={id}>{t('planPatch.stageForm.capabilities')}</FieldLabel>
    <Input id={id} value={input} aria-invalid={invalid || overLimit} aria-describedby={`${id}-help`} placeholder={t('planPatch.stageForm.capabilityPlaceholder')}
      onChange={event => event.target.value.includes(',') ? add(event.target.value) : onInput(event.target.value)}
      onBlur={() => { if (input.trim()) add(input); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(input); } }} />
    <div id={`${id}-help`}>{invalid || overLimit ? <FieldError>{t(overLimit ? 'planPatch.stageForm.capabilityLimit' : 'planPatch.stageForm.capabilityFormat')}</FieldError>
      : <FieldDescription className="text-xs">{t('planPatch.stageForm.capabilityHelp')}</FieldDescription>}</div>
    {!!values.length && <div className="flex flex-wrap gap-1.5">{values.map(value => <Badge key={value} variant="secondary" className="gap-1 font-normal">{value}
      <Button type="button" variant="ghost" size="icon-xs" className="size-5" aria-label={t('planPatch.stageForm.removeCapability').replace('{capability}', value)} onClick={() => onValues(values.filter(item => item !== value))}><X /></Button>
    </Badge>)}</div>}
    {suggestions.some(value => !values.includes(value) && capabilityPattern.test(value)) && <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('planPatch.stageForm.suggestions')}>
      <span className="text-xs text-muted-foreground">{t('planPatch.stageForm.suggestions')}</span>
      {suggestions.filter(value => !values.includes(value) && capabilityPattern.test(value)).map(value => <Button key={value} type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={values.length >= 8} onClick={() => add(value)}>{value}</Button>)}
    </div>}
  </Field>;
}
