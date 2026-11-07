import { expect, it, vi } from 'vitest';
import { openProjectEvents, type EventSourceLike, type ProjectEventsOptions } from '../src/api/events';
import { event, id, otherId } from './fixtures';

export class FakeEventSource extends EventTarget implements EventSourceLike {
  readyState = 0;
  close = vi.fn(() => { this.readyState = 2; });
  emit(name: string, data?: unknown, lastEventId = '') {
    this.dispatchEvent(data === undefined ? new Event(name) : new MessageEvent(name, { data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId }));
  }
}
function setup() {
  const source = new FakeEventSource(); const onEvent = vi.fn(); const onStatus = vi.fn(); const onSnapshotRequired = vi.fn();
  const factory = vi.fn(() => source);
  const stream = openProjectEvents({ projectId: id, baseUrl: '/api', eventSourceFactory: factory, onEvent, onStatus, onSnapshotRequired });
  return { source, onEvent, onStatus, onSnapshotRequired, stream, factory };
}
it('opens cookie-authenticated SSE with no custom cursor', () => {
  const { factory, stream } = setup();
  expect(factory).toHaveBeenCalledWith(`/api/projects/${id}/events`, { withCredentials: false }); stream.close();
});
it('delivers valid events and remembers lastEventId', () => {
  const { source, onEvent, stream } = setup(); source.emit('factory-event', event(), `${id}:1`);
  expect(onEvent).toHaveBeenCalledWith(event()); expect(stream.diagnostics.lastEventId).toBe(`${id}:1`); stream.close();
});
it.each(['{', {}, { ...event(), extra: true }, { ...event(), projectId: otherId }])('ignores and counts malformed event %#', (data) => {
  const { source, onEvent, stream } = setup(); expect(() => source.emit('factory-event', data)).not.toThrow();
  expect(onEvent).not.toHaveBeenCalled(); expect(stream.diagnostics.invalidMessages).toBe(1); stream.close();
});
it.each(['expired', 'epoch-changed', 'gap'])('snapshot %s closes and reports reason', (reason) => {
  const { source, onSnapshotRequired, onStatus } = setup();
  source.emit('snapshot-required', { apiVersion: 1, projectId: id, type: 'snapshot-required', reason });
  expect(source.close).toHaveBeenCalledOnce(); expect(onSnapshotRequired).toHaveBeenCalledWith(reason);
  expect(onStatus).toHaveBeenLastCalledWith('closed', expect.any(Object));
});
it('invalid snapshot is counted and leaves the connection open', () => {
  const { source, onSnapshotRequired, stream } = setup(); source.emit('snapshot-required', { reason: 'invalid' });
  expect(source.close).not.toHaveBeenCalled(); expect(onSnapshotRequired).not.toHaveBeenCalled(); expect(stream.diagnostics.invalidMessages).toBe(1); stream.close();
});
it('maps connecting, open, reconnecting and closed', () => {
  const { source, onStatus } = setup(); expect(onStatus.mock.calls[0]![0]).toBe('connecting');
  source.readyState = 1; source.emit('open'); expect(onStatus).toHaveBeenLastCalledWith('open', expect.any(Object));
  source.readyState = 0; source.emit('error'); expect(onStatus).toHaveBeenLastCalledWith('reconnecting', expect.any(Object));
  source.readyState = 2; source.emit('error'); expect(onStatus).toHaveBeenLastCalledWith('closed', expect.any(Object));
});
it('an error with readyState OPEN retains open status', () => {
  const { source, onStatus, stream } = setup(); source.readyState = 1; source.emit('error'); expect(onStatus).toHaveBeenLastCalledWith('open', expect.any(Object)); stream.close();
});
it('close removes listeners and is idempotent', () => {
  const { source, stream } = setup(); const remove = vi.spyOn(source, 'removeEventListener'); stream.close(); stream.close();
  expect(remove).toHaveBeenCalledTimes(4); expect(source.close).toHaveBeenCalledOnce();
});
it('ping comments and unnamed messages do not invoke callbacks', () => {
  const { source, onEvent, stream } = setup(); source.emit('message', ': ping'); source.emit('ping');
  expect(onEvent).not.toHaveBeenCalled(); expect(stream.diagnostics.invalidMessages).toBe(0); stream.close();
});
it('there are no callbacks after close even for queued events', () => {
  const { source, onEvent, onSnapshotRequired, onStatus, stream } = setup(); stream.close(); const count = onStatus.mock.calls.length;
  source.emit('factory-event', event()); source.emit('snapshot-required', { apiVersion: 1, projectId: id, type: 'snapshot-required', reason: 'gap' }); source.emit('open'); source.emit('error');
  expect(onEvent).not.toHaveBeenCalled(); expect(onSnapshotRequired).not.toHaveBeenCalled(); expect(onStatus).toHaveBeenCalledTimes(count);
});
it('production base URL is empty and project IDs are escaped', () => {
  const source = new FakeEventSource(); const factory = vi.fn(() => source);
  const options: ProjectEventsOptions = { projectId: 'a/b', eventSourceFactory: factory, onEvent: vi.fn(), onSnapshotRequired: vi.fn() };
  openProjectEvents(options).close(); expect(factory).toHaveBeenCalledWith('/projects/a%2Fb/events', { withCredentials: false });
});
