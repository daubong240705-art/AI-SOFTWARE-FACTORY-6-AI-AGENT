import type { TaskCard } from '../../data/types';

export type WorkflowLocale = 'vi' | 'en';
export const taskColumns = ['todo', 'doing', 'review', 'failed', 'done'] as const;
export const workflowColors = {
  todo: '#FFF8E7', doing: '#E0A458', review: '#F2B8A9', failed: '#D66B65', done: '#B5D3A7',
  pending: '#C9C5BE', active: '#E0A458', skipped: '#E9E4DB',
};
export const handoffColors: Readonly<Record<string, string>> = {
  assign: '#E0A458', request: '#E0A458', handoff: '#AFCFE6', review: '#F2B8A9', question: '#F2B8A9',
  answer: '#B5D3A7', output: '#CDBFE6', rework: '#D66B65', finished: '#B5D3A7', failed: '#D66B65',
};

type Stats = { cards: Record<TaskCard['column'], number>; handoffsActive: number; handoffsSeen: number; stages: number };
const boards = new Map<object, Stats['cards']>();
const flights = new Map<object, { active: number; seen: number }>();
const tables = new Map<object, number>();
/** Registrations are per mount, so StrictMode and unmounts do not leave stale counts. */
export const workflowDebug = { boards, flights, tables };
export function workflowStats(): Stats {
  const cards = { todo: 0, doing: 0, review: 0, failed: 0, done: 0 };
  for (const board of boards.values()) for (const column of taskColumns) cards[column] += board[column];
  return {
    cards,
    handoffsActive: [...flights.values()].reduce((sum, entry) => sum + entry.active, 0),
    handoffsSeen: [...flights.values()].reduce((sum, entry) => sum + entry.seen, 0),
    stages: [...tables.values()].reduce((sum, count) => sum + count, 0),
  };
}
