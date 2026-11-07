import { vi } from 'vitest';
import { createStore } from '../src/state/store';
import type { ApiClient } from '../src/api/client';
import type { ProjectEventsOptions } from '../src/api/events';
import { envelope, project, team, engagement, seat, budget, receipt } from './fixtures';

export function setupUI() {
  const api = {
    csrfToken: null,
    health: vi.fn().mockResolvedValue(envelope),
    session: vi.fn().mockResolvedValue({ ...envelope, csrfToken: 'fixture-csrf' }),
    bootstrap: vi.fn().mockResolvedValue({ ...envelope, csrfToken: 'fixture-csrf' }),
    logout: vi.fn().mockResolvedValue(envelope),
    listProjects: vi.fn().mockResolvedValue({ ...envelope, projects: [project] }),
    getTeam: vi.fn().mockResolvedValue({ ...envelope, team, engagement, seats: [seat] }),
    listTasks: vi.fn().mockResolvedValue({ ...envelope, items: [] }),
    listConversations: vi.fn().mockResolvedValue({ ...envelope, conversations: [] }),
    listMessages: vi.fn().mockResolvedValue({ ...envelope, messages: [], turns: [] }),
    getBudget: vi.fn().mockResolvedValue({ ...envelope, budget }),
    sendCommand: vi.fn().mockResolvedValue({ ...envelope, receipt }),
  };
  const connections: ProjectEventsOptions[] = [];
  const store = createStore({ api: api as ApiClient, openEvents(options) {
    connections.push(options);
    options.onStatus?.('connecting', { lastEventId: null, invalidMessages: 0 });
    return { close: vi.fn() };
  } });
  return { store, api, connections };
}
