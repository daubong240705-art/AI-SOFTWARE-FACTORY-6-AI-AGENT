import { MascotEmpty } from '@/components/mascot';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { SystemCard, SystemRead } from './SystemCard';

export function CommandsCard({ store }: { store: Store }) {
  const t = useT(); const commands = store.useStoreSelector(state => state.system.capabilities?.commands ?? []);
  const groups = new Map<string, string[]>();
  for (const command of [...new Set(commands)].sort()) {
    const prefix = command.split('.')[0] ?? command;
    groups.set(prefix, [...(groups.get(prefix) ?? []), command]);
  }
  return <SystemCard title={t('systemUi.commands')}><SystemRead store={store} area="capabilities">
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="group w-full justify-between px-0">
        <span>{t('systemUi.showCommands')}</span><span className="flex items-center gap-3"><Badge variant="secondary">{t('systemUi.commandCount').replace('{count}', String(commands.length))}</Badge><ChevronDown className="group-data-[state=open]:rotate-180" /></span>
      </Button></CollapsibleTrigger>
      <CollapsibleContent>
        {groups.size ? <div className="mt-3 divide-y divide-border border-t border-border">
          {[...groups].map(([prefix, names]) => <div key={prefix} className="space-y-2 py-4 last:pb-0">
            <p className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span className="font-mono">{prefix}</span><span>{t('systemUi.commandCount').replace('{count}', String(names.length))}</span></p>
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0">{names.map(name => <li key={name} className="font-mono text-xs break-all text-muted-foreground">{name}</li>)}</ul>
          </div>)}
        </div> : <MascotEmpty seat="DevOps" compact><p className="pt-4 text-sm text-muted-foreground">{t('systemUi.noCommands')}</p></MascotEmpty>}
      </CollapsibleContent>
    </Collapsible>
  </SystemRead></SystemCard>;
}
