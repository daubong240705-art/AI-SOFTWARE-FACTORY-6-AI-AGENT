import { useT } from '../i18n';
import { useUiProfile } from './uiProfile';

/** Label of a "create" call to action: in the games profile those buttons open the New game dialog, so they say so. */
export function CreateLabel() {
  const t = useT();
  const profile = useUiProfile();
  return <>{t(profile === 'games' ? 'gameUi.newGame' : 'projects.create')}</>;
}
