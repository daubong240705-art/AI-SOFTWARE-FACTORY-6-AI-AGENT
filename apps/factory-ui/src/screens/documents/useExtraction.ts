import { useCallback, useEffect, useState } from 'react';
import type { Extraction, ExtractionSummary } from '@/api/documents';
import type { Store } from '@/state/store';

export type ExtractionTarget = { store: Store; projectId: string; artifactId: string; version: number };

export function useExtraction({ store, projectId, artifactId, version }: ExtractionTarget, summary: ExtractionSummary | null, enabled = true) {
  const key = `${projectId}:${artifactId}:${version}:${summary?.status ?? ''}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; value?: Extraction; error?: boolean }>({ key: '' });
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!enabled || !summary) return;
    let active = true;
    setResult({ key });
    void store.getExtraction(projectId, artifactId, version).then(({ extraction }) => {
      if (active) setResult({ key, value: extraction });
    }).catch(() => { if (active) setResult({ key, error: true }); });
    return () => { active = false; };
  }, [store, projectId, artifactId, version, summary?.status, enabled, key, attempt]);
  return { extraction: result.key === key ? result.value : undefined, error: result.key === key && !!result.error, reload };
}
