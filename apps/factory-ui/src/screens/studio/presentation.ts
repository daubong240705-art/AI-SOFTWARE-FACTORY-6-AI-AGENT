export const isFinished = (state: string) => ['completed', 'failed', 'cancelled', 'superseded'].includes(state);

export function stageName(key: string, t: (key: string) => string, title?: string) {
  return ['design', 'rules', 'art', 'client', 'qa', 'reproduce'].includes(key)
    ? t(`officeUi.pipelineStages.${key}`) : title || key.replaceAll('-', ' ');
}
