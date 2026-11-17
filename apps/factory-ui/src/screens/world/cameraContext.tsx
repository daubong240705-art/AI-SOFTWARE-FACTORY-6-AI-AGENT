import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ZoneKey } from './layout/camera';
import type { Point } from './layout/zones';
export type CameraState = { target: readonly [number, number]; zoom: number; moving: boolean; following: boolean; zone: string | null };
export type CameraApi = { focusZone: (key: ZoneKey) => void; focusPoint: (point: Point, zoom?: number) => void; home: () => void; follow: (getter: (() => Point) | null) => void };
export const initialCamera: CameraState = { target: [0, 0], zoom: 16, moving: false, following: false, zone: null };
const noop: CameraApi = { focusZone() {}, focusPoint() {}, home() {}, follow() {} };
const Context = createContext({ api: noop, register: (_api: CameraApi) => {}, state: initialCamera, publish: (_state: CameraState) => {} });
export function CameraRigProvider({ children }: { children: ReactNode }) {
  const impl = useRef(noop);
  const [state, setState] = useState(initialCamera);
  const bridge = useMemo(() => ({
    api: { focusZone: key => impl.current.focusZone(key), focusPoint: (point, zoom) => impl.current.focusPoint(point, zoom), home: () => impl.current.home(), follow: getter => impl.current.follow(getter) } satisfies CameraApi,
    register: (api: CameraApi) => { impl.current = api; },
    publish: (next: CameraState) => setState(previous => previous.zone === next.zone ? previous : next),
  }), []);
  return <Context.Provider value={{ ...bridge, state }}>{children}</Context.Provider>;
}
export const useCameraRig = () => useContext(Context).api;
export const useCameraBridge = () => useContext(Context);
