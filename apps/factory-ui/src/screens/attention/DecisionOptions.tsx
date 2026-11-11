import type { Approval } from '@factory/contracts';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { useT } from '../../i18n';
import { readableText } from './presentation';

export function DecisionOptions({ approval, id, value, onChange, disabled }: { approval: Approval; id: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const t = useT();
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0"><legend className="mb-3 text-sm font-semibold">{t('inboxUi.options')}</legend>
    <RadioGroup name={`${id}-option`} aria-label={t('inboxUi.options')} value={value} onValueChange={onChange} disabled={disabled}>
      {approval.options.map(item => <Label key={item.id} htmlFor={`${id}-${item.id}`} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 leading-relaxed', value === item.id && 'border-ring bg-secondary', disabled && 'cursor-default opacity-60')}>
        <RadioGroupItem id={`${id}-${item.id}`} value={item.id} className="mt-1" aria-describedby={`${id}-${item.id}-consequence`} />
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-semibold">{readableText(item.label)}{approval.recommendation === item.id && <Badge variant="secondary" className="border-border text-xs font-normal">{t('reviewUi.recommended')}</Badge>}</span><span id={`${id}-${item.id}-consequence`} className="mt-1 block text-sm font-normal whitespace-pre-wrap text-muted-foreground">{readableText(item.consequence)}</span></span>
      </Label>)}
    </RadioGroup>
  </fieldset>;
}
