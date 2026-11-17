export const isFinished = (state: string) => ['completed', 'failed', 'cancelled', 'superseded'].includes(state);

export function stageName(key: string, t: (key: string) => string, title?: string) {
  if (key === 'client') return t('gameSummary.client');
  return ['design', 'rules', 'art', 'client', 'qa', 'reproduce'].includes(key)
    ? t(`officeUi.pipelineStages.${key}`) : title || key.replaceAll('-', ' ');
}

/** Shared plain-language status for Home and the game summary. */
export function gameStatus(state: string | undefined, step: string | null | undefined, t: (key: string) => string) {
  if (state === 'awaiting-approval') return { label: t('gameSummary.review'), className: 'text-need' };
  if (state === 'completed') return { label: t('gameSummary.done'), className: 'text-ok' };
  if (state && ['failed', 'stalled', 'blocked', 'paused', 'suspended', 'cancelled', 'superseded'].includes(state)) return { label: t('gameSummary.stuck'), className: 'text-destructive' };
  return { label: t('gameSummary.working').replace('{step}', step ? stageName(step, t) : t('gameSummary.preparing')), className: 'text-run' };
}
