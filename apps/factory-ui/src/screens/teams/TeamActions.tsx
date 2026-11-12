import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { engagementsCreate, teamsSetLifecycle } from '../../api/commands';
import type { OrgTeam } from '../../api/m3Models';
import { useT } from '../../i18n';
import type { useM3Command } from '../M3Shared';

export function TeamActions({ team, projectId, command }: {
  team: OrgTeam;
  projectId: string | null;
  command: ReturnType<typeof useM3Command>;
}) {
  const t = useT();
  const disabled = command.busy || !projectId;
  const transitions = team.lifecycle === 'archived'
    ? [] : (['active', 'paused', 'archived'] as const).filter((value) => value !== team.lifecycle);
  const changeLifecycle = (lifecycle: 'active' | 'paused' | 'archived') => {
    if (!projectId || command.busy) return;
    void command.run(teamsSetLifecycle({ projectId, teamId: team.id, expectedRevision: team.revision, lifecycle }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {transitions.length + 1 > 3 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={t('ux4.teamActions')}>
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {transitions.map((value) => (
              <DropdownMenuItem key={value} disabled={disabled} onSelect={() => changeLifecycle(value)}>
                {t(`m3.lifecycle.${value}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : transitions.map((value) => (
        <Button key={value} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => changeLifecycle(value)}>
          {t(`m3.lifecycle.${value}`)}
        </Button>
      ))}
      <Button
        type="button"
        size="sm"
        disabled={disabled || team.lifecycle !== 'active' || team.engagements.some((item) => item.projectId === projectId && item.state === 'active')}
        onClick={() => {
          if (!projectId || command.busy) return;
          void command.run(engagementsCreate({ projectId, teamId: team.id, engagementId: crypto.randomUUID(), priority: 50, maxConcurrent: 2 }));
        }}
      >
        {t('m3.invite')}
      </Button>
    </div>
  );
}
