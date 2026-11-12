import { memo, type CSSProperties, type ReactNode } from 'react';
import { mascotDefinition, seatHash, type MascotSkin } from './skins';
import { useMascotSkin } from './preference';
import type { MascotState } from './state';
import { Animal } from './Animal';
import { Accessory, Face, Effects } from './Details';
import './mascot.css';
type Props = { seat: string; state?: MascotState; size?: number; skin?: MascotSkin; title?: string; decorative?: boolean; animated?: boolean; fallback?: ReactNode };
export const Mascot = memo(function Mascot({ seat, state = 'idle', size = 40, skin, title, decorative = true, animated = true, fallback = null }: Props) {
  const preference = useMascotSkin(); const selected = skin ?? preference;
  if (selected === 'off') return fallback;
  const definition = mascotDefinition(seat, selected);
  const style = { width: size, height: size, '--mascot-delay': `${-(seatHash(seat) % 47) / 10}s` } as CSSProperties;
  return <span className={`mascot mascot-${state}${animated ? '' : ' mascot-static'}`} style={style} role={title || !decorative ? 'img' : undefined} aria-label={title || (!decorative ? seat : undefined)} aria-hidden={title || !decorative ? undefined : true}>
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" focusable="false"><g className="mascot-body" stroke="currentColor" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round"><Animal definition={definition} /><Face state={state} /><Accessory kind={state === 'working' || state === 'typing' ? 'laptop' : definition.accessory ?? 'none'} />{definition.accessory === 'crown' && (state === 'working' || state === 'typing') && <Accessory kind="crown" />}</g><Effects state={state} /></svg>
  </span>;
});

