import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { ErrorNotice } from '../components/ErrorNotice';

export function TeamPanel({ store }: { store: Store }) {
  const t = useT();
  const { team, loading, errors } = store.useStoreSelector((state) => state);
  if (loading.team && !team) return <Card><p role="status">{t('viewStates.loading')}</p></Card>;
  return <div className="stack">
    {errors.team && <ErrorNotice error={errors.team} />}
    {!team ? !errors.team && <Card><p>{t('empty.team')}</p></Card> : <>
      <Card><h2>{team.team.name}</h2><h3>{t('team.engagement')}</h3>
        <dl className="engagement">
          <div><dt>{t('team.priority')}</dt><dd>{team.engagement.priority}</dd></div>
          <div><dt>{t('team.maxConcurrent')}</dt><dd>{team.engagement.maxConcurrent}</dd></div>
          <div><dt>{t('team.state')}</dt><dd>{t(`team.states.${team.engagement.state}`)}</dd></div>
        </dl>
      </Card>
      <h2>{t('team.seats')}</h2>
      {team.seats.length === 0 ? <Card><p className="muted">{t('team.emptySeats')}</p></Card> : <ul className="seat-list stack">{team.seats.map((seat) => <li key={seat.id}><Card>
        <div className="seat-heading"><h3>{seat.name}</h3>{seat.isLead && <Badge className="lead">{t('team.lead')}</Badge>}</div>
        <dl className="engagement">
          <div><dt>{t('team.role')}</dt><dd>{seat.role}</dd></div>
          <div><dt>{t('team.runtime')}</dt><dd>{seat.runtime}</dd></div>
          <div><dt>{t('team.slots')}</dt><dd>{seat.slots}</dd></div>
        </dl>
      </Card></li>)}</ul>}
    </>}
  </div>;
}
