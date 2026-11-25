import { commandSchema, type Command, type LibraryResponse } from '@factory/contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import { ReadFeedback } from '../library/shared';
import { SkillsTab } from '../library/SkillsTab';
import { TemplatesTab } from '../library/TemplatesTab';
import { useGroupLabels, useGroups } from './GroupsContext';

export function GroupLibrary({ groupId, library, loading, error }: { groupId: string; library?: LibraryResponse | undefined; loading: boolean; error?: Error | undefined }) {
  const t = useGroupLabels();
  const global = useT();
  const { api, submit, refreshKey, refresh, list } = useGroups();
  const props = {
    api, refreshKey, refresh, blocked: loading || !!error,
    submit: (build: () => Command) => submit(() => {
      const command = build();
      return command.type === 'skills.create' || command.type === 'templates.create'
        ? commandSchema.parse({ ...command, payload: { ...command.payload, groupId } }) : command;
    }),
  };
  const owned = library ? {
    skills: library.skills.filter(item => item.groupId === groupId),
    templates: library.templates.filter(item => item.groupId === groupId),
  } : undefined;
  const inherited = library ? [...library.skills.map(item => ({ ...item, type: 'skills' })), ...library.templates.map(item => ({ ...item, type: 'templates' }))]
    .filter(item => item.groupId !== groupId) : [];
  return <div className="min-w-0 space-y-4">
    <ReadFeedback loading={loading} error={error} retry={refresh} />
    {owned && <Tabs defaultValue="skills">
      <TabsList aria-label={t('library')}>
        <TabsTrigger data-testid="group-library-skills" value="skills">{global('libraryUi.skills')}</TabsTrigger>
        <TabsTrigger data-testid="group-library-templates" value="templates">{global('libraryUi.templates')}</TabsTrigger>
      </TabsList>
      <TabsContent value="skills"><SkillsTab {...props} library={owned} /></TabsContent>
      <TabsContent value="templates"><TemplatesTab {...props} library={{ ...owned, skills: library?.skills ?? owned.skills }} libraryError={error} /></TabsContent>
    </Tabs>}
    {inherited.length > 0 && <details className="rounded-xl border border-border p-4 text-sm"><summary className="cursor-pointer font-medium">{t('inheritedLibrary')}</summary>
      <ul className="mt-3 grid max-h-64 gap-2 overflow-auto">{inherited.map(item => <li className="break-words" key={`${item.type}:${item.id}`}>
        {item.name} <span className="text-muted-foreground">· {global(`libraryUi.${item.type}`)} · {list.data?.groups.find(group => group.id === item.groupId)?.path ?? global('nav.library')}</span>
      </li>)}</ul>
    </details>}
  </div>;
}
