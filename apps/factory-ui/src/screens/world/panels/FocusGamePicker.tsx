import { worldCopy, type WorkflowLocale } from '../copy';

export type FocusGamePickerProps = {
  games: readonly { projectId: string; name: string }[];
  focusProjectId: string | null;
  onFocusGame: (projectId: string) => void;
  locale?: WorkflowLocale;
  className?: string;
};

/** HTML overlay; mount outside Canvas and position with the shared projection layer. */
export function FocusGamePicker({ games, focusProjectId, onFocusGame, locale = 'vi', className }: FocusGamePickerProps) {
  const labels = worldCopy[locale].workflow;
  const index = games.findIndex(game => game.projectId === focusProjectId);
  const focus = games[index];
  const move = (direction: number) => {
    const next = games[(Math.max(0, index) + direction + games.length) % games.length];
    if (next) onFocusGame(next.projectId);
  };
  return <div className={className} role="group" aria-label={labels.focus}>
    <button type="button" aria-label={labels.previous} disabled={games.length < 2} onClick={() => move(-1)}>◀</button>
    <span aria-live="polite" title={focus?.name}>{focus?.name ?? labels.empty}</span>
    <button type="button" aria-label={labels.next} disabled={games.length < 2} onClick={() => move(1)}>▶</button>
  </div>;
}
