import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useT } from '@/i18n';
import { useMascotSkin, setMascotSkin } from './preference';
import type { MascotSkin } from './skins';
export function SkinSelect() {
  const t = useT(); const id = useId(); const skin = useMascotSkin();
  return <div className="grid gap-2"><Label htmlFor={id}>{t('mascot.label')}</Label><Select value={skin} onValueChange={value => setMascotSkin(value as MascotSkin)}><SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(['classic', 'forest', 'ocean', 'fantasy', 'off'] as const).map(value => <SelectItem key={value} value={value}>{t(`mascot.skins.${value}`)}</SelectItem>)}</SelectContent></Select></div>;
}
