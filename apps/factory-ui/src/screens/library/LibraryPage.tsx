import { useReducer, useState } from 'react';
import { Library } from 'lucide-react';
import { createApiClient } from '@/api/client';
import { Page } from '@/components/Page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAgentWrite, useRead } from '../agents/shared';
import { ReadFeedback, useLibraryLabels } from './shared';
import { SkillsTab } from './SkillsTab';
import { TemplatesTab } from './TemplatesTab';

export default function LibraryPage() {
  const t = useLibraryLabels();
  const [api] = useState(() => createApiClient({ baseUrl: import.meta.env.DEV ? '/api' : '' }));
  const [refreshKey, refresh] = useReducer((value: number) => value + 1, 0);
  const library = useRead(api.getAgentLibrary, refreshKey);
  const submit = useAgentWrite(api, refresh);
  const props = { api, refreshKey, refresh, submit, blocked: library.loading || !!library.error, libraryError: library.error };
  return <Page className="space-y-5 px-4 py-5 sm:px-8">
    <header className="space-y-1">
      <h1 className="flex items-center gap-2 text-xl font-semibold"><Library className="size-5 text-muted-foreground" aria-hidden="true" />{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('help')}</p>
    </header>
    <ReadFeedback error={library.error} loading={library.loading} retry={refresh} />
    <Tabs defaultValue="skills">
      <TabsList aria-label={t('title')}>
        <TabsTrigger data-testid="library-skills" value="skills">{t('skills')}</TabsTrigger>
        <TabsTrigger data-testid="library-templates" value="templates">{t('templates')}</TabsTrigger>
      </TabsList>
      {library.data && <>
        <TabsContent value="skills"><SkillsTab {...props} library={library.data} /></TabsContent>
        <TabsContent value="templates"><TemplatesTab {...props} library={library.data} /></TabsContent>
      </>}
    </Tabs>
  </Page>;
}
