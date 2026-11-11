import type { Approval } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { StoreError } from '../../state/store';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useT } from '../../i18n';
import { ActionHints } from './ActionHints';
import { readableText } from './presentation';

type Props = {
  approval: Approval; inline: boolean; confirm: boolean; command: boolean; busy: boolean; valid: boolean; optionId: string;
  onPrimary: () => void; onChanges: () => void; onConfirmChanges: () => void; onExecute: () => void; onBack: () => void; onRetry: () => void;
  error?: StoreError | undefined; failed: boolean;
};
export function DecisionActions({ approval, inline, confirm, command, busy, valid, optionId, onPrimary, onChanges, onConfirmChanges, onExecute, onBack, onRetry, error, failed }: Props) {
  const t = useT(); const option = approval.options.find(item => item.id === optionId);
  return <footer className="sticky bottom-0 z-10 mt-auto border-t border-border bg-background">
    {confirm && option && <Card role="group" aria-label={t('taskUi.confirmation')} className="mx-6 my-4 gap-3 border-border p-4 shadow-none"><p className="text-sm"><strong className="font-semibold">{readableText(option.label)}</strong><span className="mt-1 block leading-relaxed whitespace-pre-wrap text-muted-foreground">{readableText(option.consequence)}</span></p><div className="flex gap-2"><Button disabled={busy || command} onClick={onExecute}>{t('workUi.confirm')}</Button><Button variant="outline" disabled={busy || command} onClick={onBack}>{t('workUi.back')}</Button></div></Card>}
    {error && <div className="px-6 pt-4"><ErrorNotice error={error} /></div>}
    <div className="flex flex-wrap items-center gap-2.5 px-6 py-3.5">
      {!confirm && !command && <>
        <Button className={inline ? 'bg-need text-need-foreground hover:bg-need/90' : ''} data-attention-primary={inline ? '' : undefined} disabled={busy || (approval.kind === 'question' && !valid) || (!inline && !valid) || (inline && approval.kind === 'review' && !approval.options.some(item => item.id === 'accept' || item.id === 'approve'))} onClick={onPrimary}>{t(inline ? approval.kind === 'review' ? 'attention.approve' : 'attention.answer' : 'inboxUi.decide')}</Button>
        {inline && approval.kind === 'review' && approval.options.some(item => item.id === 'request-changes') && <Button variant="outline" data-attention-changes disabled={busy} onClick={onChanges}>{t('attention.requestChanges')}</Button>}
        {inline && approval.kind === 'review' && optionId === 'request-changes' && <Button variant="outline" disabled={!valid || busy} onClick={onConfirmChanges}>{t('attention.requestChangesConfirm')}</Button>}
      </>}
      {failed && <Button variant="outline" disabled={busy} onClick={onRetry}>{t('errors.retry')}</Button>}
      {inline && <ActionHints />}
    </div>
  </footer>;
}
