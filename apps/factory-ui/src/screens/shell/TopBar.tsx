import { useEffect, useRef, useState } from 'react';
import { Menu, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { ProjectTile } from './ProjectTile';
import { TaskStatus } from './TaskStatus';

export function TopBar({ store, compact, expanded, onToggle, onNewTask, onProject, onTask }: {
  store: Store; compact: boolean; expanded: boolean; onToggle: () => void; onNewTask: () => void;
  onProject: (id: string) => void; onTask: (projectId: string, taskId: string) => void;
}) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const [open, setOpen] = useState(false); const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(value => !value); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const streamLabel = state.stream === 'closed' ? 'shell.offline' : 'shell.reconnecting';
  return <>
    <header className="col-start-2 flex min-w-0 items-center gap-3 border-b border-border bg-background px-6 max-[1179px]:col-start-1 max-sm:gap-2 max-sm:px-4">
      {compact && <Button variant="ghost" size="icon" aria-label={t('shell.toggleProjects')} aria-expanded={expanded} aria-controls="factory-navigation" onClick={onToggle}><Menu /></Button>}
      <div className="relative min-w-0 flex-1 sm:max-w-[560px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input ref={search} readOnly aria-label={t('shell.searchTasks')} aria-haspopup="dialog" aria-expanded={open} placeholder={t('shell.searchPlaceholder')} className="h-9 cursor-text border-border bg-transparent pr-14 pl-9 shadow-none dark:bg-transparent max-sm:pr-2" onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true); } }} />
        <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 border border-border bg-transparent font-mono max-sm:hidden">Ctrl K</Kbd>
      </div>
      <div className="flex-1 max-sm:hidden" />
      {state.selectedProjectId && state.stream !== 'open' && <p role="status" className="hidden items-center gap-2 text-xs text-muted-foreground xl:flex"><span className={`size-[5px] rounded-full ${state.stream === 'closed' ? 'bg-muted-foreground' : 'bg-run'}`} aria-hidden="true" />{t(streamLabel)}</p>}
      <Button onClick={onNewTask} className="rounded-lg"><Plus />{t('shell.newTask')}</Button>
    </header>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="overflow-hidden rounded-xl border-border bg-popover p-0 sm:max-w-xl" onCloseAutoFocus={event => { event.preventDefault(); search.current?.focus(); }}>
        <DialogTitle className="sr-only">{t('shell.searchTasks')}</DialogTitle>
        <DialogDescription className="sr-only">{t('shell.searchDescription')}</DialogDescription>
        <Command className="border-0">
          <CommandInput placeholder={t('shell.searchPlaceholder')} aria-label={t('shell.searchTasks')} className="border-0 bg-transparent px-0 shadow-none" />
          <CommandList className="max-h-[420px] p-2">
            <CommandEmpty>{t('shell.noSearchResults')}</CommandEmpty>
            <CommandGroup heading={t('shell.projectTasks')}>
              {state.tasks.filter(task => task.projectId === state.selectedProjectId).map(task => <CommandItem key={task.id} value={`task ${task.code} ${task.title} ${task.id}`} className="gap-3 border-0 bg-transparent px-3 py-3" onSelect={() => { setOpen(false); onTask(task.projectId, task.id); }}>
                <span className="font-mono text-xs">{task.code}</span><span className="min-w-0 flex-1 truncate">{task.title}</span><TaskStatus task={task} state={state} dotOnly />
              </CommandItem>)}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t('global.projects')}>
              {state.projects.map(project => <CommandItem key={project.id} value={`project ${project.name} ${project.id}`} className="gap-3 border-0 bg-transparent px-3 py-3" onSelect={() => { setOpen(false); onProject(project.id); }}><ProjectTile id={project.id} name={project.name} /><span>{project.name}</span></CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  </>;
}
