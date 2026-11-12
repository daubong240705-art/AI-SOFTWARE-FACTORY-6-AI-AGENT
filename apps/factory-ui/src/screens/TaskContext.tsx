import { useEffect } from 'react';
import type { Store } from '../state/store';
import { useT } from '../i18n';
import { AreaState } from './M3Shared';
import { Card } from '@/components/ui/card';
import { Facts, Fold } from './attention/ReviewShared';
import { readableText } from './attention/presentation';
export function TaskContext({ store, taskId }: { store: Store; taskId: string }) {
  const t = useT(); const packs = store.useStoreSelector(s => s.m3.contexts[taskId]);
  useEffect(() => store.watchM3(`context:${taskId}`, () => store.loadContext(taskId)), [store,taskId]);
  return <Card className="gap-3 border-border p-5 shadow-none"><h3 className="text-sm font-semibold">{t('m3.context')}</h3><AreaState store={store} area={`context:${taskId}`} empty={packs?.length === 0} />{packs?.map(pack => <section className="space-y-3 border-t border-border pt-3" key={pack.attemptId}><h4 className="text-sm font-medium">{t('reviewUi.attempt')} {pack.epoch}</h4><Facts rows={[[t('m3.tokens'), `${pack.tokens} / ${pack.maxTokens}`], [t('knowledgeUi.l0'), String(pack.l0)], [t('knowledgeUi.l1'), String(pack.l1)], [t('m3.omitted'), String(pack.omitted)]]} />
    <Fold title={t('attention.technicalDetails')}><ul className="space-y-2 font-mono text-xs text-muted-foreground">{pack.pack.omitted.map((value, index) => <li className="break-all" key={index}>{value.ref.artifactId}@{value.ref.version}: {readableText(t(`m3.values.${value.reason}`))}</li>)}</ul>{pack.instructions && <Facts mono rows={[[t('attention.digest'), pack.instructions.packDigest], [t('m3.instructions'), pack.instructions.profilePath], [t('m3.skills'), String(pack.instructions.skillsCount)]]} />}</Fold>
  </section>)}</Card>;
}
