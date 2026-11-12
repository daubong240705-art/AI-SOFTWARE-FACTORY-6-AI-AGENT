import { Mascot } from '@/components/mascot';
import { seatNames } from '@/components/mascot/skins';
import type { MascotState } from '@/components/mascot/state';
import { useMascotSkin } from '@/components/mascot/preference';
import { SkinSelect } from '@/components/mascot/SkinSelect';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useT } from '@/i18n';
const states: MascotState[] = ['idle', 'thinking', 'working', 'done', 'typing', 'attention', 'error', 'success', 'offline'];
export default function MascotGallery() {
  const t = useT(); const skin = useMascotSkin();
  return <div className="space-y-6 p-6"><header className="flex flex-wrap items-start justify-between gap-5"><div><h1 className="font-display text-4xl font-semibold tracking-tight">{t('mascot.gallery')}</h1><p className="mt-2 text-sm text-muted-foreground">{t('mascot.description')}</p></div><div className="w-48"><SkinSelect /></div></header>
    <Card className="gap-4 rounded-xl border-border p-5 shadow-none"><h2 className="font-display text-xl font-semibold">{t('mascot.sizes')}</h2><div className="flex flex-wrap items-end gap-6">{[24, 32, 40, 64, 96].map(size => <div key={size} className="grid justify-items-center gap-3"><Mascot seat="Lead" size={size} title={`Lead · ${size}px`} fallback={<Avatar><AvatarFallback>L</AvatarFallback></Avatar>} /><span className="font-mono text-xs text-muted-foreground">{size}px</span></div>)}</div></Card>
    {skin === 'off' && <p className="text-sm text-muted-foreground">{t('mascot.disabled')}</p>}
    {seatNames.map(seat => <Card key={seat} className="gap-4 rounded-xl border-border p-5 shadow-none"><h2 className="text-sm font-medium">{seat}</h2><div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-5 xl:grid-cols-9">{states.map(state => <div key={state} className="grid justify-items-center gap-2"><Mascot seat={seat} state={state} size={64} title={`${seat} · ${t(`mascot.states.${state}`)}`} fallback={<Avatar><AvatarFallback>{seat[0]}</AvatarFallback></Avatar>} /><span className="text-center text-xs text-muted-foreground">{t(`mascot.states.${state}`)}</span></div>)}</div></Card>)}
  </div>;
}
