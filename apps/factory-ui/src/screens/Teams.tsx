import type { Store } from '../state/store';
import { TeamsPage } from './teams/TeamsPage';
import type { TeamTab } from './shell/navigation';

export function Teams({ store, tab, onTabChange, onTask }: {
  store: Store; tab: TeamTab; onTabChange: (tab: TeamTab) => void; onTask: (projectId: string, taskId: string) => void;
}) {
  return <TeamsPage store={store} tab={tab} onTabChange={onTabChange} onTask={onTask} />;
}
