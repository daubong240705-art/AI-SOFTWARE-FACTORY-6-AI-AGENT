import type { OrgActivity } from '../api/activityModels';

export type ActivityState = OrgActivity | null;
export const emptyActivity = (): ActivityState => null;
