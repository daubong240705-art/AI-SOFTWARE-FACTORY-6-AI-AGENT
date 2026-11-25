import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { icons, tools, toys } from './scene/toys/store';
import { useToys } from './scene/toys/useToys';
import { unlockSound } from './scene/toys/sound';

/** 1–9 or Alt+wheel in either view. Plain wheel remains camera zoom in Walk. */
export function WorldHotbar({ collapsed, onCollapse }: { walking: boolean; collapsed: boolean; onCollapse: (value: boolean) => void }) {
  const state = useToys(), t = useT(), id = useId();
  const [soundSelected, setSoundSelected] = useState(false), [hover, setHover] = useState<number | null>(null);
  const selected = state.tool ? tools.indexOf(state.tool) + 1 : soundSelected ? 8 : 0;
  const select = (slot: number) => {
    slot = Math.max(0, Math.min(8, slot));
    setSoundSelected(slot === 8);
    toys.select(slot > 0 && slot < 8 ? tools[slot - 1]! : null);
    if (slot === 8) { toys.mute(); if (toys.snapshot().sound) unlockSound(); }
  };
  const latest = useRef({ selected, select }); latest.current = { selected, select };
  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]');
    const key = (event: KeyboardEvent) => {
      if (editable(event.target) || event.repeat || event.ctrlKey || event.metaKey || event.altKey || !/^[1-9]$/.test(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation(); latest.current.select(Number(event.key) - 1);
    };
    const wheel = (event: WheelEvent) => {
      if (!event.altKey || editable(event.target) || !(event.target instanceof Element && event.target.closest('.world-map,.world-hotbar')) || !event.deltaY) return;
      event.preventDefault(); event.stopImmediatePropagation(); latest.current.select((latest.current.selected + Math.sign(event.deltaY) + 9) % 9);
    };
    document.addEventListener('keydown', key, true); document.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('wheel', wheel, true); };
  }, []);
  useEffect(() => {
    const deadlines = [...state.active.map(e => e.until), ...state.combo.map(e => e.until), ...state.sulking.map(e => e.until)];
    const timer = setTimeout(() => toys.refresh(), Math.max(1, Math.min(...deadlines, Date.now() + 60000) - Date.now()));
    return () => clearTimeout(timer);
  }, [state]);
  const name = (slot: number) => slot === 0 ? t('worldUi.toys.pointer') : slot === 8 ? t(state.sound ? 'worldUi.toys.soundOn' : 'worldUi.toys.soundOff') : t(`worldUi.toys.${tools[slot - 1]!}`);
  const description = (slot: number) => {
    const tool = tools[slot - 1];
    return [name(slot), tool ? t(tool === 'whip' ? 'worldUi.toys.whipCount' : 'worldUi.toys.count').replace('{tool}', name(slot)).replace('{count}', String(state.counts[tool] ?? 0)) : '', t('worldUi.toys.note'), '1–9 · Alt + wheel'].filter(Boolean).join(' · ');
  };
  return <div className={`world-hotbar${collapsed ? ' world-hotbar-collapsed' : ''}`}>
    <button className="world-hotbar-handle" aria-expanded={!collapsed} aria-controls={id} aria-label={t(collapsed ? 'worldUi.expandHotbar' : 'worldUi.collapseHotbar')} onClick={() => onCollapse(!collapsed)}>{collapsed ? '▴' : '▾'}</button>
    <div id={id} hidden={collapsed} role="toolbar" aria-label={t('worldUi.toys.title')} className="world-hotbar-slots" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll('button')], at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? 8 : (at + (event.key === 'ArrowRight' ? 1 : 8)) % 9]?.focus();
    }}>
      {Array.from({ length: 9 }, (_, slot) => <button key={slot} type="button" aria-pressed={selected === slot} aria-label={`${slot + 1}. ${description(slot)}`} aria-describedby={hover === slot ? `${id}-tip` : undefined} title={description(slot)} onFocus={() => setHover(slot)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(slot)} onMouseLeave={() => setHover(null)} onClick={() => select(slot)}><kbd>{slot + 1}</kbd><span aria-hidden="true">{slot === 0 ? '↖' : slot === 8 ? state.sound ? '🔊' : '🔇' : icons[tools[slot - 1]!]}</span></button>)}
    </div>
    {!collapsed && hover !== null && <div id={`${id}-tip`} role="tooltip" className="world-hotbar-tooltip">{description(hover)}</div>}
  </div>;
}
