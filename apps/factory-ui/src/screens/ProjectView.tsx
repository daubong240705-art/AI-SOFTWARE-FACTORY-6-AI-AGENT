import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Project } from '@factory/contracts';
import { i18n, plural, useT } from '../i18n';
import type { Store } from '../state/store';
import { ProjectChat } from './ProjectChat';
import { ProjectTasks } from './ProjectTasks';
import { Badge } from '../components/Badge';
import { TeamPanel } from './TeamPanel';
import { Inbox, inboxCount } from './Inbox';

const tabs = ['chat', 'tasks', 'team', 'inbox'] as const;
export function ProjectView({ store, project }: { store: Store; project: Project }) {
  const t = useT();
  const proposed = store.useStoreSelector((state) => state.tasks.filter((task) => task.state === 'proposed').length);
  const inboxTotal = store.useStoreSelector(state => state.inbox.counts.total);
  const [active, setActive] = useState(0);
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); setActive(next); buttons.current[next]?.focus();
  }
  return <div className="project-view stack">
    <header role="generic" className="projectbar stack"><h1>{project.name}</h1>
      <div role="tablist" aria-label={t('shell.projectTabs')} className="project-tabs">
        {tabs.map((tab, index) => <button key={tab} ref={(node) => { buttons.current[index] = node; }} type="button" role="tab" id={`${id}-${tab}`} aria-controls={`${id}-panel`} aria-selected={active === index} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={(event) => navigate(event, index)}>{t(tab === 'inbox' ? 'inboxUi.inbox' : `tabs.${tab}`)}{tab === 'inbox' && inboxTotal > 0 && <> <Badge>{inboxCount(t, inboxTotal)}</Badge></>}{tab === 'tasks' && proposed > 0 && <> <Badge>{new Intl.NumberFormat(i18n.locale).format(proposed)} {plural(t, i18n.locale, proposed, 'taskUi.proposedCount')}</Badge></>}</button>)}
      </div>
    </header>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tabs[active]}`} tabIndex={0}>
      {active === 0 ? <ProjectChat store={store} projectId={project.id} /> : active === 1 ? <ProjectTasks store={store} projectId={project.id} /> : active === 2 ? <TeamPanel store={store} /> : <Inbox store={store} />}
    </div>
  </div>;
}
