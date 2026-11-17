import type { Task } from '@factory/contracts';
import type { OrgTeam } from '@/api/m3Models';
import type { WorkflowDetail } from '@/api/m5Models';
import type { OfficeSeat } from '@/api/officeModels';
const stageKeys = ['design', 'rules', 'art', 'client', 'qa'] as const;
const stageCapabilities = ['game.design', 'game.rules', 'game.ui', 'game.client', 'test.e2e'];

/** Preserve the source order for seats serving the same stage and for unmatched seats. */
export function orderGameSeats(seats: OfficeSeat[], detail: WorkflowDetail | undefined, teams: OrgTeam[], tasks: Task[]) {
  if (!detail) return seats;
  const ranks = new Map(seats.map(seat => {
    const owned = stageKeys.findIndex(key => detail.stages.find(stage => stage.key === key)?.tasks.some(link =>
      tasks.some(task => task.id === link.taskId && task.ownerSeatId === seat.id) || seat.runs.some(run => run.taskId === link.taskId)));
    const capabilities = teams.find(team => team.id === seat.teamId)?.seats.find(item => item.id === seat.id)?.capabilities ?? [];
    const capable = stageKeys.findIndex((key, index) => {
      const required = detail.graph?.stages.find(stage => stage.key === key)?.requiredCapabilities ?? [stageCapabilities[index]!];
      return required.length > 0 && required.every(capability => capabilities.includes(capability));
    });
    return [seat.id, owned >= 0 ? owned : capable >= 0 ? capable : stageKeys.length] as const;
  }));
  const others = seats.filter(seat => !seat.isLead).sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
  let index = 0;
  return seats.map(seat => seat.isLead ? seat : others[index++]!);
}

