import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient } from '@/api/client';
import { createWorldDataController, emptyWorldSnapshot, type WorldDataApi, type WorldSnapshot } from './controller';
export type { WorldDataApi, WorldSource } from './controller';

export type WorldData = WorldSnapshot & {
  focusProjectId: string | null;
  setFocusProjectId: (id: string | null) => void;
  consumeEvents: (ids?: readonly string[]) => void;
};

/** Accepts either a validated API client or the store's stateless read passthroughs. */
export function useWorldData(apiArg?: WorldDataApi): WorldData {
  const api = useMemo(() => apiArg ?? createApiClient({baseUrl: import.meta.env.DEV ? '/api' : ''}), [apiArg]);
  const [snapshot, setSnapshot] = useState(emptyWorldSnapshot);
  const choice = useRef<string | null>(null);
  const controller = useRef<ReturnType<typeof createWorldDataController> | null>(null);
  const setFocusProjectId = useCallback((id: string | null) => {
    choice.current = id;
    controller.current?.setFocusProjectId(id);
  }, []);
  const consumeEvents = useCallback((ids?: readonly string[]) => controller.current?.consumeEvents(ids), []);
  useEffect(() => {
    const engine = createWorldDataController(api, {hidden: () => document.hidden, onSnapshot: setSnapshot, focusProjectId: choice.current});
    controller.current = engine;
    engine.start();
    const visibility = () => engine.visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      engine.stop();
      if (controller.current === engine) controller.current = null;
    };
  }, [api]);
  return {...snapshot, focusProjectId: snapshot.model.focusProjectId, setFocusProjectId, consumeEvents};
}
