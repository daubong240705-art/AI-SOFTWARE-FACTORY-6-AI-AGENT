import { useSyncExternalStore } from 'react';
import { toys } from './store';
export const useToys = () => useSyncExternalStore(toys.subscribe, toys.snapshot, toys.snapshot);
