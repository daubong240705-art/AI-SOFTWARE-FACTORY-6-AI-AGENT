import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { OrgTeam } from '@/api/m3Models';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { SeatRuntimeDialog } from './SeatRuntimeDialog';

export function SeatRuntimeButton({ store, seat }: { store: Store; seat: OrgTeam['seats'][number] }) {
  const t = useT(); const [open, setOpen] = useState(false);
  return <><Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`${t('agentConfig.open')} ${seat.name}`}><Settings2 aria-hidden="true" />{t('agentConfig.open')}</Button>
    {open && <SeatRuntimeDialog store={store} seat={seat} onClose={() => setOpen(false)} />}
  </>;
}
