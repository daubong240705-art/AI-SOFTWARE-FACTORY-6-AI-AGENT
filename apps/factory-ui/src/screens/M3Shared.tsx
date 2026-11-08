import { useRef, useState } from 'react';
import type { Command } from '@factory/contracts';
import type { Store } from '../state/store';
import { ErrorNotice } from '../components/ErrorNotice';
import { Button } from '../components/Button';
import { useT } from '../i18n';

export function AreaState({ store, area, empty = false }: { store: Store; area: string; empty?: boolean }) {
  const t = useT(); const state = store.useStoreSelector(s => s);
  return <>{state.loading[area] && <p role="status">{t('viewStates.loading')}</p>}{state.errors[area] && <ErrorNotice error={state.errors[area]!} />}{empty && !state.loading[area] && !state.errors[area] && <p>{t('m3.empty')}</p>}</>;
}
export function Select({ label, value, onChange, options, required = false }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>; required?: boolean }) {
  return <label className="field">{label}<select required={required} value={value} onChange={e => onChange(e.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>;
}
export function useM3Command(store: Store, refresh: () => Promise<void>) {
  const [command, setCommand] = useState<Command | null>(null); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const state = store.useStoreSelector(s => s); const t = useT();
  async function execute(created: Command) {
    if (lock.current || store.getState().session !== 'authenticated') return;
    lock.current = true; setBusy(true); setCommand(created);
    try { const response = await store.send(created); if (response) { setCommand(null); await refresh(); } else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') await refresh(); }
    finally { lock.current = false; setBusy(false); }
  }
  const error = command ? state.pending[command.commandId]?.error : undefined;
  const conflict = error?.code === 'conflict';
  return { busy: busy || (!!command && !conflict), run: execute, notice: <>{error && <ErrorNotice error={error} />}{error && !conflict && <Button disabled={busy} onClick={() => { if (command) void execute(command); }}>{t('errors.retry')}</Button>}{conflict && <p role="status">{t('m3.changed')}</p>}</> };
}
