import { LoadingState } from '@/components/LoadingState';
import type { ComponentProps, ReactNode } from 'react';
import { ErrorNotice } from '@/components/ErrorNotice';
import { MascotEmpty } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { useT } from '@/i18n';
import type { Store, StoreError } from '@/state/store';

export function useAreaState(store: Store, area: string): { loading: boolean; error: StoreError | undefined } {
  return store.useStoreSelector(state => ({ loading: !!state.loading[area], error: state.errors[area] }));
}

export function ViewState({ loading = false, error, onRetry, empty = false, emptyText, emptyAction, seat = 'Lead', mascotState = 'idle', compact = false }: {
  loading?: boolean; error?: StoreError | null | undefined; onRetry?: () => void;
  empty?: boolean; emptyText?: string; emptyAction?: ReactNode;
  seat?: ComponentProps<typeof MascotEmpty>['seat']; mascotState?: ComponentProps<typeof MascotEmpty>['state']; compact?: boolean;
}) {
  const t = useT();
  if (loading) return <LoadingState inline />;
  if (error) return <div className="space-y-3"><ErrorNotice error={error} />{onRetry && <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('errors.retry')}</Button>}</div>;
  if (!empty) return null;
  const content = <><EmptyDescription>{emptyText ?? t('m3.empty')}</EmptyDescription>{emptyAction}</>;
  return <Empty className="p-6 md:p-8"><MascotEmpty seat={seat} state={mascotState} compact={compact} fallback={content}>{content}</MascotEmpty></Empty>;
}
