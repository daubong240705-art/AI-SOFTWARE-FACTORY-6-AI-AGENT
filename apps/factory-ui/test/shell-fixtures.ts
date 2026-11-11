import { setupUI } from './ui-fixtures';
import { envelope, otherId, project } from './fixtures';
import type { Inbox } from '../src/api/client';

export const secondProject = { ...project, id: otherId, name: 'Second project' };
export async function setupShell(inbox?: Inbox) {
  const fixture = setupUI();
  fixture.api.listProjects.mockResolvedValue({ ...envelope, projects: [project, secondProject] });
  if (inbox) fixture.api.getGlobalInbox.mockResolvedValue({ ...envelope, ...inbox });
  await fixture.store.boot();
  await fixture.store.loadProjects();
  return fixture;
}

export function compactMedia(matches = true) {
  const media = Object.assign(new EventTarget(), { matches });
  return (query: string) => query.includes('max-width') ? media : Object.assign(new EventTarget(), { matches: false });
}
