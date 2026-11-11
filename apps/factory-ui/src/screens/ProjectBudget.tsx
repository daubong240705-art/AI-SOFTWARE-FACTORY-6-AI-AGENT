import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';

export function ProjectBudget({ store }: { store: Store }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const day = state.budget?.day;
  const number = new Intl.NumberFormat(i18n.locale);
  return <section className="project-budget">
    {day ? <div className={`budget budget-${day.verdict}`}>
      <span>{t('chatUi.budget')}</span>
      <meter aria-label={t('chatUi.budget')} min={0} max={day.limit} value={Math.min(day.used, day.limit)} aria-valuemin={0} aria-valuemax={day.limit} aria-valuenow={Math.min(day.used, day.limit)} aria-valuetext={`${number.format(day.used)} / ${number.format(day.limit)} ${t('chatUi.tokens')}`} />
      <span>{number.format(day.used)} / {number.format(day.limit)} {t('chatUi.tokens')}</span><strong>{t(`chatUi.verdict.${day.verdict}`)}</strong>
    </div> : <p className="muted">{t('chatUi.budgetLoading')}</p>}
    {state.errors.budget && <ErrorNotice error={state.errors.budget} />}
  </section>;
}

