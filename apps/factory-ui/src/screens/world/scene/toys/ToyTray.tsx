import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { icons, tools, toys, type Tool } from './store';
import { useToys } from './useToys';
import { tone, unlockSound } from './sound';
export function playToy(worker: string, tool: Tool, quiet: boolean) {
  if (toys.apply(worker, tool, quiet) && toys.snapshot().sound && !quiet) {
    const effect = toys.snapshot().active.find(e => e.worker === worker)!;
    tone(tool, effect.combo);
    if (effect.cheered) tone('cheer');
    if (effect.sulkUntil) tone('sulk');
  }
}
export function ToyTray({ selected, quiet, walking = false }: { walking?: boolean; selected: string | null; quiet: boolean }) {
  const state = useToys(), t = useT(); const badge = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const deadlines = [...state.active.map(effect => effect.until), ...state.combo.map(c => c.until), ...state.sulking.map(s => s.until)];
    if (!deadlines.length) return;
    const timer = setTimeout(() => toys.refresh(), Math.max(1, Math.min(...deadlines) - Date.now()));
    return () => clearTimeout(timer);
  }, [state.active, state.combo, state.sulking]);
  useEffect(() => {
    if (!state.open || walking) return;
    toys.refresh();
    const timer = setInterval(() => toys.refresh(), 1000);
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest('input,textarea,select') || target.isContentEditable) || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') { event.stopPropagation(); toys.open(false); return; }
      const tool = tools[Number(event.key) - 1];
      if (tool && selected) { event.preventDefault(); event.stopPropagation(); playToy(selected, tool, quiet); }
    };
    document.addEventListener('keydown', key, true);
    return () => { clearInterval(timer); document.removeEventListener('keydown', key, true); };
  }, [state.open, selected, quiet, walking]);
  useEffect(() => {
    if (!state.tool || walking) return;
    const move = (event: PointerEvent) => { if (badge.current) { badge.current.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`; badge.current.hidden = !(event.target instanceof Element && event.target.closest('.world-map')); } };
    document.addEventListener('pointermove', move);
    return () => document.removeEventListener('pointermove', move);
  }, [state.tool, walking]);
  return <>
    <Button variant="outline" size="sm" aria-expanded={state.open} onClick={() => toys.open(!state.open)}>{t('worldUi.toys.title')}</Button>
    {state.open && <div className="world-toy-tray" role="group" aria-label={t('worldUi.toys.title')}>
      <p>{t('worldUi.toys.note')}</p>
      <div className="world-toy-tools">{tools.map((tool, i) => <Button key={tool} variant={state.tool === tool ? 'default' : 'outline'} size="sm" aria-pressed={state.tool === tool} onClick={() => toys.select(state.tool === tool ? null : tool)}>{i + 1} {icons[tool]} {t(`worldUi.toys.${tool}`)}</Button>)}</div>
      <Button variant="ghost" size="sm" aria-pressed={state.sound} onClick={() => { toys.mute(); if (toys.snapshot().sound) unlockSound(); }}>{t(state.sound ? 'worldUi.toys.soundOn' : 'worldUi.toys.soundOff')}</Button>
      <Button variant="ghost" size="sm" onClick={() => toys.select(null)}>{t('worldUi.toys.pointer')}</Button>
      <p>{t('worldUi.toys.keyboard')}</p>
      {state.tool && <p role="status">{t(state.tool === 'whip' ? 'worldUi.toys.whipCount' : 'worldUi.toys.count').replace('{tool}', t(`worldUi.toys.${state.tool}`)).replace('{count}', String(state.counts[state.tool] ?? 0))}</p>}
    </div>}
    {state.tool && !walking && <span ref={badge} hidden className="world-toy-cursor" aria-hidden="true">{icons[state.tool]}</span>}
  </>;
}
