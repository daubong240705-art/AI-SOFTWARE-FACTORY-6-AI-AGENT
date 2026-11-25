import { useEffect, useReducer, useState } from 'react';
import { openProjectEvents } from '@/api/events';

export const baseUrl = import.meta.env.DEV ? '/api' : '';

export function useLiveRead<Data>(projectId: string, read: (signal: AbortSignal) => Promise<Data>) {
  const [refreshKey, refresh] = useReducer((value: number) => value + 1, 0);
  const [state, setState] = useState<{ data?: Data; error?: unknown }>({});
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: ReturnType<typeof openProjectEvents> | undefined;
    const load = async () => {
      if (controller.signal.aborted) return;
      if (running) { queued = true; return; }
      running = true;
      try {
        const data = await read(controller.signal);
        if (!controller.signal.aborted) setState({ data });
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => ({ ...previous, error }));
      } finally {
        running = false;
        if (queued) { queued = false; void load(); }
      }
    };
    const schedule = () => { timer ??= setTimeout(() => { timer = undefined; void load(); }, 150); };
    const connect = () => {
      if (typeof EventSource !== 'undefined') stream = openProjectEvents({ projectId, baseUrl,
        onEvent: schedule, onSnapshotRequired: () => { schedule(); connect(); },
        onStatus: status => { if (status === 'open') schedule(); },
      });
    };
    connect();
    void load();
    const poll = setInterval(() => void load(), 5000);
    return () => { controller.abort(); clearInterval(poll); clearTimeout(timer); stream?.close(); };
  }, [projectId, read, refreshKey]);
  return { ...state, refresh };
}
