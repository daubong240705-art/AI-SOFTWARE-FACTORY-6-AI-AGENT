import { useId, useState } from 'react';
import { modelNameSchema } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field';
import { useT } from '@/i18n';

export function ModelPickerManual({ onAdd, disabled = false }: { onAdd: (model: string) => void; disabled?: boolean }) {
  const t = useT(); const id = useId();
  const [value, setValue] = useState(''); const [invalid, setInvalid] = useState(false);
  function add() {
    if (!modelNameSchema.safeParse(value).success) { setInvalid(true); return; }
    if (disabled) return;
    onAdd(value); setValue(''); setInvalid(false);
  }
  return <div className="space-y-2">
    <p className="text-xs leading-relaxed text-muted-foreground">{t('modelsUi.unavailable')}</p>
    <Label htmlFor={id} className="text-xs">{t('modelsUi.manual')}</Label>
    <div className="flex gap-2"><Input id={id} value={value} maxLength={256} disabled={disabled} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={event => { setValue(event.target.value); setInvalid(false); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} />
      <Button type="button" variant="outline" disabled={disabled} onClick={add}>{t('modelsUi.add')}</Button></div>
    {invalid && <FieldError id={`${id}-error`}>{t('modelsUi.invalidModel')}</FieldError>}
  </div>;
}
