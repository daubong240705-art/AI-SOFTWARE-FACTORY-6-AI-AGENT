import { extra as vi } from '../../i18n/extra.vi';
import { extra as en } from '../../i18n/extra.en';
import type { Pose } from './characters/spec';
export type WorldLocale = 'vi' | 'en';
export type WorkflowLocale = WorldLocale;
export type LabLocale = WorldLocale;
export type GalleryLocale = WorldLocale;
export const worldCopy = { vi: vi.worldUi, en: en.worldUi };
export const poseLabels = Object.fromEntries(Object.keys(en.worldUi.poses).map(pose => [pose, {
  vi: vi.worldUi.poses[pose as Pose], en: en.worldUi.poses[pose as Pose],
}])) as Record<Pose, { vi: string; en: string }>;
