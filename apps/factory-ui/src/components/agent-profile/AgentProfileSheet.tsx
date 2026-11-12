import { useEffect } from 'react';
import { Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { AgentProfileContent, AgentSkillsContent } from './AgentProfileContent';
import { AgentToolsContent } from './AgentToolsContent';

export function AgentProfileSheet({ store, packKey, packVersion, seatName }: { store: Store; packKey: string; packVersion: string | null; seatName: string }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const pack = state.packDetails[packKey];
  const error = state.errors[`pack:${packKey}`];
  const seat = pack?.seats.find(value => value.name === seatName);
  useEffect(() => { void store.loadPack(packKey); }, [store, packKey]);
  return (
    <SheetContent side="right" showCloseButton={false} className="w-full gap-0 border-border bg-background sm:max-w-[560px]">
      <SheetHeader className="gap-2 border-b border-border p-6 pr-16">
        <SheetTitle className="font-display text-3xl leading-tight [overflow-wrap:anywhere]">{seatName}</SheetTitle>
        <SheetDescription>{t('agentProfile.source')}</SheetDescription>
      </SheetHeader>
      <SheetClose asChild>
        <Button variant="ghost" size="icon" className="absolute right-4 top-4" aria-label={t('agentProfile.close')}><X aria-hidden="true" /></Button>
      </SheetClose>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-6">
          {!pack && !error && <div role="status" aria-label={t('agentProfile.loading')} className="space-y-4">
            <span className="sr-only">{t('agentProfile.loading')}</span>
            <Skeleton className="h-9 w-3/4" /><Skeleton className="h-48 w-full" />
          </div>}
          {error && <div role="alert" className="space-y-3 rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">{t('agentProfile.loadError')}</p>
            <Button variant="outline" onClick={() => void store.loadPack(packKey, true)}>{t('agentProfile.retry')}</Button>
          </div>}
          {pack && !seat && <p role="status" className="text-sm text-muted-foreground">{t('agentProfile.missingSeat')}</p>}
          {pack && seat && <Tabs defaultValue="profile" className="gap-6">
            <TabsList variant="pills" aria-label={t('agentProfile.tabs')}>
              <TabsTrigger value="profile">{t('agentProfile.profile')}</TabsTrigger>
              <TabsTrigger value="skills">{t('agentProfile.skills')}</TabsTrigger>
              <TabsTrigger value="tools">{t('agentProfile.tools')}</TabsTrigger>
            </TabsList>
            <TabsContent value="profile"><AgentProfileContent pack={pack} seat={seat} packVersion={packVersion} /></TabsContent>
            <TabsContent value="skills"><AgentSkillsContent skills={pack.skills} /></TabsContent>
            <TabsContent value="tools"><AgentToolsContent store={store} seat={seat} /></TabsContent>
          </Tabs>}
          <div className="flex items-start gap-3 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>{t('agentProfile.editNote')}</p>
          </div>
        </div>
      </ScrollArea>
    </SheetContent>
  );
}
