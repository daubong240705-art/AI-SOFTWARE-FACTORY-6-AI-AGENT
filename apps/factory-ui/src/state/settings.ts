import type { AutonomyResponse, StandingApprovalsResponse } from '../api/client';

export type SettingsState = { autonomy: AutonomyResponse | null; standingApprovals: StandingApprovalsResponse | null };
export const emptySettings = (): SettingsState => ({ autonomy: null, standingApprovals: null });
