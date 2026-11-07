import { useT } from '../i18n';
import { Card } from '../components/Card';

export function ProjectChatPlaceholder() {
  const t = useT();
  return <Card><h2>{t('tabs.chat')}</h2><p className="muted">{t('shell.comingSoon')}</p></Card>;
}
export function ProjectTasksPlaceholder() {
  const t = useT();
  return <Card><h2>{t('tabs.tasks')}</h2><p className="muted">{t('shell.comingSoon')}</p></Card>;
}
