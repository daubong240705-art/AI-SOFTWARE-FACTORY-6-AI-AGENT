import type { Command } from '@factory/contracts';
import type { AutomationRule, Monitor, Schedule } from '@/api/client';
import type { Store } from '@/state/store';

export type Area = 'schedules' | 'rules' | 'monitors';
export type AutomationCommand = Extract<Command, { type: `schedules.${string}` | `rules.${string}` | `monitors.${string}` }>;
export type Editor = { area: 'schedules'; item?: Schedule } | { area: 'rules'; item?: AutomationRule } | { area: 'monitors'; item?: Monitor };
export type Target = { area: 'schedules'; item: Schedule } | { area: 'rules'; item: AutomationRule } | { area: 'monitors'; item: Monitor };
export type FormProps<T> = { store: Store; projectId: string; item?: T; onClose: () => void };

// Patches contain only values the person changed. Omitted Host settings remain untouched.
export function changed<T extends object>(before: T, after: T): Partial<T> {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof T]))) as Partial<T>;
}
export function pendingKey(area: Area, id = 'new') { return `automation:${area}:${id}`; }
