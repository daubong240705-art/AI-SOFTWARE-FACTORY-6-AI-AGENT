import type { ReactNode } from 'react';
import { CommandFormFrame } from '@/components/CommandFormFrame';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { pendingKey, type Area, type AutomationCommand } from './types';

export function FormFrame({ area, itemId, store, onClose, onSubmit, children }: {
  area: Area; itemId?: string | undefined; store: Store; onClose: () => void;
  onSubmit: () => AutomationCommand | string; children: ReactNode;
}) {
  const t = useT();
  return <CommandFormFrame pendingKey={pendingKey(area, itemId)} store={store} onClose={onClose} onSubmit={onSubmit} send={store.sendAutomation}
    title={t(`automationWrite.${itemId ? 'editTitle' : 'add'}.${area}`)} description={t('automationWrite.formHelp')}
    submitLabel={t(itemId ? 'automationWrite.save' : 'automationWrite.create')} invalidKey="automationWrite.invalid">{children}</CommandFormFrame>;
}