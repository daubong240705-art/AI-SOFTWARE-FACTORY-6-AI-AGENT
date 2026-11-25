import { LoadingState } from '@/components/LoadingState';
import { lazy, useEffect, useRef } from 'react';
import { MotionConfig } from 'motion/react';
import { i18n, useT } from './i18n';
import { defaultStore, type Store } from './state/store';
import { SignIn } from './screens/SignIn';
import { AppShell } from './screens/AppShell';
import { Toaster } from '@/components/ui/sonner';
import { GroupsProvider } from './screens/groups/GroupsContext';

const LibraryPage = lazy(() => import('./screens/library/LibraryPage'));

export function App({ store = defaultStore }: { store?: Store }) {
  const t = useT();
  const session = store.useStoreSelector((state) => state.session);
  const booted = useRef<Store | null>(null);
  useEffect(() => { if (booted.current !== store) { booted.current = store; void store.boot(); } }, [store]);
  useEffect(() => { document.documentElement.lang = i18n.locale; }, [t, i18n.locale]);
  return <MotionConfig reducedMotion="user">
    {session === 'unknown' ? <main className="signin"><LoadingState /></main>
      : session === 'anonymous' ? <SignIn store={store} /> : <GroupsProvider><AppShell store={store} libraryPage={<LibraryPage />} /></GroupsProvider>}
    <Toaster position="bottom-right" richColors={false} />
  </MotionConfig>;
}

export default App;
