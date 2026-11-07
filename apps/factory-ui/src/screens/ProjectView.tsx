import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Project } from '@factory/contracts';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { ProjectChatPlaceholder } from './placeholders';
import { ProjectTasksPlaceholder } from './placeholders';
import { TeamPanel } from './TeamPanel';

const tabs = ['chat', 'tasks', 'team'] as const;
export function ProjectView({ store, project }: { store: Store; project: Project }) {
  const t = useT();
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
        {tabs.map((tab, index) => <button key={tab} ref={(node) => { buttons.current[index] = node; }} type="button" role="tab" id={`${id}-${tab}`} aria-controls={`${id}-panel`} aria-selected={active === index} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={(event) => navigate(event, index)}>{t(`tabs.${tab}`)}</button>)}
      </div>
    </header>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tabs[active]}`} tabIndex={0}>
      {active === 0 ? <ProjectChatPlaceholder /> : active === 1 ? <ProjectTasksPlaceholder /> : <TeamPanel store={store} />}
    </div>
  </div>;
}
