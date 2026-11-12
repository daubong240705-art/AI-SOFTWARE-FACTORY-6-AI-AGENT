import { Badge } from '@/components/ui/badge';
import type { Store } from '@/state/store';

export function SeatRuntimeBadge({ store, seatId }: { store: Store; seatId: string }) {
  const config = store.useStoreSelector(state => state.m3.teams.flatMap(team => team.seats).find(seat => seat.id === seatId)?.runtimeConfig);
  const label = config?.runtime === 'native-opencode' ? 'OpenCode' : config?.cli === 'codex' ? 'Codex' : config?.cli === 'claude' ? 'Claude' : null;
  return label ? <Badge variant="outline" className="text-xs font-normal" title={config?.model ?? undefined}>{label}</Badge> : null;
}
