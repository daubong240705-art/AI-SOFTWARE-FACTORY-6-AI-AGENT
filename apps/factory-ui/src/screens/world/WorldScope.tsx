import { Choice, ChoiceOption } from '@/components/ui/choice';
import { useT } from '@/i18n';
import type { ScopeGroup, WorldScope } from './data/scope';

export function WorldScopePicker({ groups, group, scope, onChange, projectPickerId }: {
  groups: readonly ScopeGroup[]; group: ScopeGroup; scope: WorldScope; onChange: (scope: WorldScope) => void; projectPickerId: string;
}) {
  const t = useT();
  return <div className="world-focus world-control">
    <label className="flex min-w-0 items-center gap-2 text-sm">{t('worldUi.scope.group')}
      <Choice className="bg-transparent" value={scope.groupId ?? ''} onValueChange={id => onChange({ groupId: id || null, projectId: null })}>
        {groups.map(option => <ChoiceOption key={option.id ?? ''} value={option.id ?? ''}>{option.name || t('worldUi.scope.ungrouped')}</ChoiceOption>)}
      </Choice>
    </label>
    <label className="flex min-w-0 items-center gap-2 text-sm">{t('worldUi.scope.project')}
      <Choice id={projectPickerId} className="bg-transparent" value={scope.projectId ?? ''} disabled={!group.projects.length} onValueChange={id => onChange({ groupId: scope.groupId, projectId: id || null })}>
        <ChoiceOption value="">{t('worldUi.scope.allProjects')}</ChoiceOption>
        {group.projects.map(project => <ChoiceOption key={project.id} value={project.id}>{project.name}</ChoiceOption>)}
      </Choice>
    </label>
  </div>;
}

export function WorldOtherGroups({ groups, group, onChange }: {
  groups: readonly ScopeGroup[]; group: ScopeGroup; onChange: (scope: WorldScope) => void;
}) {
  const t = useT();
  const others = groups.filter(option => option.id !== group.id && (option.id !== null || option.projects.length > 0));
  if (!others.length) return null;
  return <details className="world-other-groups world-control">
    <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{t('worldUi.scope.others')} ({others.length})</summary>
    <ul>{others.map(option => <li key={option.id ?? ''}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-secondary" onClick={() => onChange({ groupId: option.id, projectId: null })}>
      <span className="block break-words font-medium">{option.name || t('worldUi.scope.ungrouped')}</span>
      <span className="text-xs text-muted-foreground">{t('worldUi.scope.counts').replace('{agents}', String(option.agents)).replace('{working}', String(option.working)).replace('{waiting}', String(option.waiting))}</span>
    </button></li>)}</ul>
  </details>;
}
