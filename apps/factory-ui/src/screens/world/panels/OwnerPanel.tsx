import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { DockedPane } from '../../DockedPane';
import type { WorldModel } from '../data/types';

export function OwnerPanel({ model, attention, error, onClose, onCreate, onChat, onAttention }: {
  model: WorldModel; attention: number; error: boolean; onClose: () => void;
  onCreate: (kind: 'game' | 'task') => void; onChat: (id: string) => void; onAttention: () => void;
}) {
  const t = useT(); const selectId = useId(); const [choice, setChoice] = useState('');
  const project = model.games.find(game => game.projectId === choice)?.projectId ?? model.games[0]?.projectId;
  return <DockedPane label={t('worldUi.ownerDesk')} onClose={onClose} className="world-panel min-w-0 max-w-full">
    <div className="mb-4 flex items-center justify-between gap-2"><h2 className="font-semibold">{t('worldUi.ownerDesk')}</h2><Button variant="ghost" size="sm" onClick={onClose}>{t('worldUi.close')}</Button></div>
    {error ? <p role="status">{t('worldUi.sourceError')}</p> : <dl className="mb-4 grid grid-cols-2 gap-2 text-sm"><dt>{t('worldUi.workingCount')}</dt><dd>{model.loaded.activity ? model.agents.filter(agent => agent.status === 'working').length : '—'}</dd><dt>{t('worldUi.attentionCount')}</dt><dd>{attention}</dd><dt>{t('worldUi.productionCount')}</dt><dd>{model.loaded.games ? model.productionGames : '—'}</dd></dl>}
    <div className="flex flex-col items-stretch gap-2">
      <Button onClick={() => onCreate('game')}>{t('worldUi.createGame')}</Button>
      <Button variant="outline" onClick={() => onCreate('task')}>{t('worldUi.assignLead')}</Button>
      <label htmlFor={selectId} className="mt-3 text-sm">{t('worldUi.chatGame')}</label>
      <select id={selectId} className="rounded-md border border-border bg-background p-2 text-sm" value={project ?? ''} onChange={event => setChoice(event.target.value)} disabled={!model.games.length}>{model.games.map(game => <option key={game.projectId} value={game.projectId}>{game.name}</option>)}</select>
      <Button variant="outline" disabled={!project} onClick={() => { if (project) onChat(project); }}>{t('worldUi.chatLead')}</Button>
      <Button variant="outline" onClick={onAttention}>{t('worldUi.openAttention')}</Button>
    </div>
  </DockedPane>;
}
