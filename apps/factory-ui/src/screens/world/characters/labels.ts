import type { Pose } from './spec';
import { extra as vi } from '../../../i18n/extra.vi';
import { extra as en } from '../../../i18n/extra.en';
// Keep the W-3 public lookup while the locale dictionaries own all label text.
export const poseLabels = Object.fromEntries(Object.keys(en.worldUi.poses).map(pose => [pose, {
  vi: vi.worldUi.poses[pose as Pose], en: en.worldUi.poses[pose as Pose],
}])) as Record<Pose, { vi: string; en: string }>;
export const codeLabels = { vi: vi.worldUi.codes, en: en.worldUi.codes };
