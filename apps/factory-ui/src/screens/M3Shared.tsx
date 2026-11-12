import { useId, useRef, useState } from 'react';
import type { Command } from '@factory/contracts';
import type { Store } from '../state/store';
import { ErrorNotice } from '../components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useT } from '../i18n';
import { Select as ThemedSelect } from '../components/Select';

export function AreaState({ store, area, empty = false }: { store: Store; area: string; empty?: boolean }) {
  const t = useT();
  const state = store.useStoreSelector((value) => value);
  return (
    <div className="space-y-3 text-sm text-muted-foreground empty:hidden">
      {state.loading[area] && <p role="status">{t('viewStates.loading')}</p>}
      {state.errors[area] && <ErrorNotice error={state.errors[area]!} />}
      {empty && !state.loading[area] && !state.errors[area] && <p>{t('m3.empty')}</p>}
    </div>
  );
}

export function Select({ label, value, onChange, options, required = false }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>; required?: boolean }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <ThemedSelect id={id} value={value} onValueChange={onChange} required={required} options={options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))} />
    </div>
  );
}

export function useM3Command(store: Store, refresh: () => Promise<void>, onSuccess?: (command: Command) => void) {
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const state = store.useStoreSelector((value) => value);
  const t = useT();

  async function execute(created: Command) {
    if (lock.current || store.getState().session !== 'authenticated') return;
    lock.current = true;
    setBusy(true);
    setCommand(created);
    try {
      const response = await store.send(created);
      if (response) {
        setCommand(null);
        await refresh();
        onSuccess?.(created);
      } else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') {
        await refresh();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const error = command ? state.pending[command.commandId]?.error : undefined;
  const conflict = error?.code === 'conflict';
  return {
    busy: busy || (!!command && !conflict),
    run: execute,
    notice: (
      <div className="space-y-3 empty:hidden">
        {error && <ErrorNotice error={error} />}
        {error && !conflict && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { if (command) void execute(command); }}>
            {t('errors.retry')}
          </Button>
        )}
        {conflict && <p role="status" className="text-sm text-muted-foreground">{t('m3.changed')}</p>}
      </div>
    ),
  };
}
