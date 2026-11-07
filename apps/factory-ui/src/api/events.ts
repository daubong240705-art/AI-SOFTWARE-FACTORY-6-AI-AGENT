import { eventSchema, streamResetSchema, type FactoryEvent } from '@factory/contracts';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
export type StreamDiagnostics = { lastEventId: string | null; invalidMessages: number };
export type EventSourceLike = Pick<EventSource, 'readyState' | 'close'> & {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};
export type ProjectEventsOptions = {
  projectId: string; baseUrl?: string;
  eventSourceFactory?: (url: string, init: EventSourceInit) => EventSourceLike;
  onEvent: (event: FactoryEvent) => void;
  onSnapshotRequired: (reason: 'expired' | 'epoch-changed' | 'gap') => void;
  onStatus?: (status: StreamStatus, diagnostics: Readonly<StreamDiagnostics>) => void;
};
export function openProjectEvents(options: ProjectEventsOptions) {
  const { projectId, baseUrl = '', onEvent, onSnapshotRequired, onStatus } = options;
  let closed = false;
  const diagnostics: StreamDiagnostics = { lastEventId: null, invalidMessages: 0 };
  let status: StreamStatus = 'connecting';
  const report = (next: StreamStatus) => { status = next; onStatus?.(next, { ...diagnostics }); };
  report('connecting');
  const source = (options.eventSourceFactory ?? ((url, init) => new EventSource(url, init)))(
    `${baseUrl.replace(/\/$/, '')}/projects/${encodeURIComponent(projectId)}/events`, { withCredentials: false });
  const invalid = () => { diagnostics.invalidMessages++; report(status); };
  const factoryEvent: EventListener = (raw) => {
    if (closed) return;
    const message = raw as MessageEvent<string>;
    let data: unknown;
    try { data = JSON.parse(message.data); } catch { invalid(); return; }
    const parsed = eventSchema.safeParse(data);
    if (!parsed.success || parsed.data.projectId !== projectId) { invalid(); return; }
    diagnostics.lastEventId = message.lastEventId || diagnostics.lastEventId;
    onEvent(parsed.data);
  };
  const snapshot: EventListener = (raw) => {
    if (closed) return;
    let data: unknown;
    try { data = JSON.parse((raw as MessageEvent<string>).data); } catch { invalid(); return; }
    const parsed = streamResetSchema.safeParse(data);
    if (!parsed.success || parsed.data.projectId !== projectId) { invalid(); return; }
    close();
    onSnapshotRequired(parsed.data.reason);
  };
  const opened = () => { if (!closed) report('open'); };
  const error = () => {
    if (closed) return;
    if (source.readyState === 2) close();
    else report(source.readyState === 1 ? 'open' : 'reconnecting');
  };
  const listeners: [string, EventListener][] = [['factory-event', factoryEvent], ['snapshot-required', snapshot], ['open', opened], ['error', error]];
  function close() {
    if (closed) return;
    closed = true;
    for (const [name, listener] of listeners) source.removeEventListener(name, listener);
    source.close();
    report('closed');
  }
  for (const [name, listener] of listeners) source.addEventListener(name, listener);
  return { close, get diagnostics(): Readonly<StreamDiagnostics> { return { ...diagnostics }; } };
}
