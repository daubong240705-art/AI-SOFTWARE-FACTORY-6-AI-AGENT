import { useEffect } from 'react';
import type { Store } from '../state/store';
import { useT } from '../i18n';
import { AreaState } from './M3Shared';
export function TaskContext({ store, taskId }: { store: Store; taskId: string }) {
  const t = useT(); const packs = store.useStoreSelector(s => s.m3.contexts[taskId]);
  useEffect(() => store.watchM3(`context:${taskId}`, () => store.loadContext(taskId)), [store,taskId]);
  return <details><summary>{t('m3.context')}</summary><AreaState store={store} area={`context:${taskId}`} empty={packs?.length === 0} />{packs?.map(pack => <section key={pack.attemptId}><h4>{t('workUi.epoch')} {pack.epoch}</h4><p>{t('m3.tokens')}: {pack.tokens}/{pack.maxTokens} | L0: {pack.l0} | L1: {pack.l1} | {t('m3.omitted')}: {pack.omitted}</p><ul>{pack.pack.omitted.map((v,i) => <li key={i}>{v.ref.artifactId}@{v.ref.version}: {t(`m3.values.${v.reason}`)} ({v.reason})</li>)}</ul>{pack.instructions && <p>{t('m3.instructions')}: {pack.instructions.packDigest.slice(0,12)} | {pack.instructions.profilePath} | {t('m3.skills')}: {pack.instructions.skillsCount}</p>}</section>)}</details>;
}
