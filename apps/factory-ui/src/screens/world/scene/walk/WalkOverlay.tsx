import { useEffect, useRef, useState, type RefObject } from 'react';
import { useT } from '@/i18n';
import { desks, zones, type Point } from '../../layout/zones';
import type { WalkState } from './state';

export function WalkOverlay({ state, positions, paused }: { state: RefObject<WalkState>; positions: RefObject<Map<string, Point>>; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), t = useT();
  const [name, setName] = useState('');
  useEffect(() => {
    const paint = () => {
      const walk = state.current;
      setName(walk.target?.name ?? '');
      const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
      ctx.clearRect(0, 0, 220, 176); ctx.fillStyle = '#FFF8E7'; ctx.fillRect(0, 0, 220, 176);
      const x = (v: number) => (v + 18) * 6 + 2, z = (v: number) => (v + 14) * 6 + 4;
      for (const zone of zones) {
        if (zone.id === 'F') continue;
        ctx.fillStyle = zone.color; ctx.globalAlpha = 0.45;
        ctx.fillRect(x(zone.rect[0]), z(zone.rect[2]), (zone.rect[1] - zone.rect[0]) * 6, (zone.rect[3] - zone.rect[2]) * 6);
        ctx.globalAlpha = 1; ctx.fillStyle = '#4A3B2F'; ctx.font = '9px sans-serif'; ctx.fillText(zone.id, x(zone.rect[0]) + 3, z(zone.rect[2]) + 10);
      }
      ctx.fillStyle = '#A87A50';
      for (const desk of desks) ctx.fillRect(x(desk.position[0]) - 5, z(desk.position[1]) - 2, 10, 4);
      ctx.fillStyle = '#527C86';
      for (const point of positions.current.values()) { ctx.beginPath(); ctx.arc(x(point[0]), z(point[1]), 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.save(); ctx.translate(x(walk.position[0]), z(walk.position[2])); ctx.rotate(-walk.yaw);
      ctx.fillStyle = '#C65742'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-4, 4); ctx.lineTo(0, 2); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
    };
    paint(); const timer = setInterval(paint, 100); return () => clearInterval(timer);
  }, [positions, state]);
  return <div className="world-walk-overlay">
    {!paused && <><span className="world-crosshair" aria-hidden="true">+</span><div className="world-walk-hint" role="status">{name ? t('worldUi.walk.open').replace('{name}', name) : t('worldUi.walk.click')}</div></>}
    <canvas ref={canvas} className="world-minimap" width={220} height={176} aria-label={t('worldUi.walk.minimap')} />
    <p className="world-walk-controls">{t(paused ? 'worldUi.walk.paused' : 'worldUi.walk.controls')}</p>
  </div>;
}
