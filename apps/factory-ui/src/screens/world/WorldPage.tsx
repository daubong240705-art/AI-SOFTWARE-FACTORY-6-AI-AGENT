import { lazy, Suspense, useCallback, useId, useRef, useState } from 'react';
import type { Project } from '@factory/contracts';
import { Mascot } from '@/components/mascot/Mascot';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import type { View } from '../shell/navigation';
import { useWorldCapability } from './capability';
import { emptyRender, useWorldDebug, type FallbackReason, type RenderStats } from './debugHook';
import { useWorldPreferences } from './preferences';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import { WorldFallback } from './WorldFallback';
import { WorldToolbar } from './WorldToolbar';

const WorldCanvas = lazy(() => import('./scene/WorldCanvas'));
export default function WorldPage({ projects, onNavigate }: { store: Store; projects: readonly Project[]; onNavigate: (view: View) => void }) {
  const t = useT(); const hintId = useId();
  const capability = useWorldCapability();
  const [preferences, change] = useWorldPreferences();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [quality, setQuality] = useState<'high' | 'low'>(preferences.quality === 'low' ? 'low' : 'high');
  const stats = useRef<RenderStats>(emptyRender);
  const reason: FallbackReason | null = preferences.mode === '2d' ? 'preference'
    : !capability.webgl2 ? 'webgl' : capability.narrow ? 'narrow'
    : capability.reducedMotion && preferences.mode !== '3d' ? 'reduced-motion' : error ? 'error' : null;
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => { setReady(false); stats.current = emptyRender; setError(true); }, []);
  const onRender = useCallback((value: RenderStats) => { stats.current = value; }, []);
  const onLoading = useCallback(() => { setReady(false); stats.current = emptyRender; }, []);
  useWorldDebug(() => ({ version: 1, mode: reason ? 'fallback' : ready ? '3d' : 'loading', fallbackReason: reason,
    ready: !reason && ready, quality, still: preferences.still, render: reason ? emptyRender : stats.current }));
  return <div className="world-page">
    {reason ? <WorldFallback reason={reason} projects={projects} onNavigate={onNavigate}
      onSwitch={() => { setReady(false); change({ mode: '3d', ...(reason === 'reduced-motion' ? { still: true } : {}) }); }}
      onRetry={() => { setReady(false); setError(false); setAttempt(value => value + 1); }} />
      : <>
        <div className="world-map" role="region" tabIndex={0} aria-label={t('worldUi.map')} aria-describedby={hintId}>
          <p id={hintId} className="sr-only">{t('worldUi.mapHint')}</p>
          <SceneErrorBoundary key={attempt} onError={onError}>
            <Suspense fallback={<div className="world-loading" role="status"><Mascot seat="Lead" state="thinking" animated={false} /><span>{t('worldUi.loading')}</span></div>}>
              <WorldCanvas qualityPreference={preferences.quality} still={preferences.still} onReady={onReady} onLoading={onLoading} onError={onError} onQuality={setQuality} onRender={onRender} />
            </Suspense>
          </SceneErrorBoundary>
        </div>
        <WorldToolbar preferences={preferences} onChange={change} />
      </>}
  </div>;
}
