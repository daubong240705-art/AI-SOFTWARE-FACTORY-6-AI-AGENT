export const settingsSections = ['automation', 'budget', 'autonomy', 'approvals', 'workflow', 'code'] as const;
export type SettingsSection = typeof settingsSections[number];
export const defaultSettingsSection: SettingsSection = settingsSections[0];
