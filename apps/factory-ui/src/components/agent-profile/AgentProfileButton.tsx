import { useState } from 'react';
import { IdCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { AgentProfileSheet } from './AgentProfileSheet';

type ProfileButtonProps = {
  store: Store;
  packKey: string | null;
  packVersion: string | null;
  seatName: string;
};

export function AgentProfileButton({ store, packKey, packVersion, seatName }: ProfileButtonProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = t('agentProfile.open').replace('{name}', seatName);

  if (!packKey) return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-md" aria-label={label}>
            <Button variant="ghost" size="sm" disabled aria-label={label}>
              <IdCard aria-hidden="true" />{t('agentProfile.profile')}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('agentProfile.noPack')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label}>
          <IdCard aria-hidden="true" />{t('agentProfile.profile')}
        </Button>
      </SheetTrigger>
      {open && <AgentProfileSheet store={store} packKey={packKey} packVersion={packVersion} seatName={seatName} />}
    </Sheet>
  );
}
