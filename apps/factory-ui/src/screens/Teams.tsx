import type { Store } from '../state/store';
import { TeamsPage } from './teams/TeamsPage';

export function Teams({ store }: { store: Store }) {
  return <TeamsPage store={store} />;
}
