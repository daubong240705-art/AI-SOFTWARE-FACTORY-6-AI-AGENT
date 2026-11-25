export const settingsSections = ['automation', 'budget', 'autonomy', 'approvals', 'code', 'group'] as const;
export type SettingsSection = typeof settingsSections[number];
export const defaultSettingsSection: SettingsSection = settingsSections[0];
