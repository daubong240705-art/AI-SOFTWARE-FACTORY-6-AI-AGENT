import type { WorldInputs, WorldModel } from '../../data/types';
export const propIds = ['server-rack', 'aquarium', 'office-cat', 'oiia-cat', 'coffee-machine', 'ping-pong-table', 'arcade-cabinet', 'day-night-window', 'swaying-plants', 'standing-fan', 'neon-sign', 'achievement-board'] as const;
export function daylight(date: Date): 'day' | 'sunset' | 'night' {
  const hour = date.getHours();
  return hour >= 6 && hour < 17 ? 'day' : hour >= 17 && hour < 19 ? 'sunset' : 'night';
}
/** QA rounds carry no dates: join their real stage iteration/task code before counting this local week. */
export function achievements(model: WorldModel, reports: WorldInputs['reports'], now: Date) {
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const released = model.loaded.games && model.games.every(g => model.loaded.releases.includes(g.projectId))
    ? new Set([...Object.keys(model.releaseVersions), ...model.gallery.filter(g => g.state === 'done').map(g => g.projectId)]).size : null;
  let passed: number | null = 0;
  for (const game of model.games) {
    const report = reports[game.projectId];
    if (!report || !model.loaded.reports.includes(game.projectId)) { passed = null; break; }
    for (const round of report.qaRounds) {
      if (round.verdict !== 'passed') continue;
      const matches = report.stages.flatMap(s => s.iterations).filter(i => i.iteration === round.iteration && i.taskCode === round.taskCode);
      const endedAt = matches.length === 1 ? Date.parse(matches[0]!.endedAt ?? '') : NaN;
      if (!Number.isFinite(endedAt)) { passed = null; break; }
      if (endedAt >= monday.getTime() && endedAt <= now.getTime()) passed++;
    }
    if (passed === null) break;
  }
  return { released, passed: model.loaded.games ? passed : null };
}

let pettable = false;
export const catCanBePetted = () => pettable;
export function setCatPettable(value: boolean) { pettable = value; }
