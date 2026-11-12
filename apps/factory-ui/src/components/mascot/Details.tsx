import type { MascotState } from './state';
export function Face({ state }: { state: MascotState }) {
  return <><g className={['idle', 'thinking', 'working', 'typing', 'attention'].includes(state) ? 'mascot-eyes' : undefined}>
    {state === 'error' ? <path d="M32 43l10 10m0-10L32 53m26-10 10 10m0-10L58 53" fill="none" /> : state === 'done' || state === 'offline' ? <path d={state === 'done' ? 'M32 49q5-9 10 0m16 0q5-9 10 0' : 'M32 48q5 5 10 0m16 0q5 5 10 0'} fill="none" /> : state === 'success' ? <g fill="currentColor"><path d="M29 42h16l-2 11H32zm26 0h16l-3 11H57z" /><path d="M45 45h10" /></g> : <g fill="currentColor" stroke="none"><ellipse cx="37" cy="47" rx="3.5" ry="5.5" /><ellipse cx="63" cy="47" rx="3.5" ry="5.5" /><g fill="var(--mascot-paper)"><circle cx="36" cy="45" r="1.3" /><circle cx="62" cy="45" r="1.3" /></g></g>}
  </g>{(state === 'thinking' || state === 'attention') && <path d={state === 'attention' ? 'M31 36l10 2m18 0 10-2' : 'M31 38l10-3m18 3 10 1'} fill="none" strokeWidth="2" />}<path d={state === 'error' ? 'M44 66q6-7 12 0' : state === 'attention' ? 'M48 63a2 3 0 104 0 2 3 0 10-4 0' : 'M44 63q6 7 12 0'} fill="none" strokeWidth="2" /><g fill="var(--mascot-blush)" opacity=".65" stroke="none"><ellipse cx="28" cy="59" rx="5" ry="3" /><ellipse cx="72" cy="59" rx="5" ry="3" /></g></>;
}
export function Accessory({ kind }: { kind?: string }) {
  if (kind === 'crown') return <><path d="M34 24l2-14 9 8 5-12 6 12 9-8 1 14z" fill="var(--mascot-yellow)" /><path d="M18 48v-7q0-14 16-17M82 48v-7q0-14-16-17m16 24v8h-7" fill="none" strokeWidth="2" /></>;
  if (kind === 'glasses') return <g fill="none" strokeWidth="2"><circle cx="37" cy="47" r="10" /><circle cx="63" cy="47" r="10" /><path d="M47 46h6M27 45l-7-3m53 3 7-3" /></g>;
  if (kind === 'headset') return <path d="M18 48v-6a32 27 0 0164 0v13h-8V44h8m-64 0h8v11h-8m64 0q0 11-16 9" fill="none" />;
  if (kind === 'laptop') return <g><rect x="23" y="70" width="54" height="23" rx="4" fill="var(--mascot-screen)" /><path d="M20 94h60M41 77l-5 4 5 4m18-8 5 4-5 4m-7-9-4 10" fill="none" strokeWidth="2.5" /></g>;
  if (kind === 'magnifier') return <g fill="var(--mascot-screen)"><circle cx="77" cy="68" r="10" /><path d="M84 76l8 10" strokeWidth="5" /></g>;
  if (kind === 'brush' || kind === 'pencil') return <g><path d="M72 80l16-22 4 4-16 22-7 3z" fill="var(--mascot-yellow)" />{kind === 'brush' && <path d="M84 61q-1-14 10-12 5 9-6 17z" fill="var(--mascot-pink)" />}</g>;
  if (kind === 'palette') return <g fill="var(--mascot-paper)"><path d="M69 63q20-7 23 9 1 12-9 6-6-4-5 4-17 0-9-19z" /><circle cx="74" cy="69" r="2" fill="var(--mascot-blue)" /><circle cx="83" cy="67" r="2" fill="var(--mascot-green)" /><circle cx="72" cy="77" r="2" fill="var(--mascot-pink)" /></g>;
  if (kind === 'database') return <g fill="var(--mascot-screen)"><path d="M65 66h25v18q-12 8-25 0z" /><ellipse cx="77.5" cy="66" rx="12.5" ry="5" /><path d="M65 74q12 8 25 0m-25 7q12 8 25 0" fill="none" strokeWidth="2" /></g>;
  if (kind === 'book' || kind === 'blueprint' || kind === 'chart') return <g fill="var(--mascot-paper)"><path d="M63 67q8-4 14 0 6-4 14 0v19q-8-4-14 0-6-4-14 0z" /><path d={kind === 'chart' ? 'M68 80l5-6 5 3 8-7' : 'M77 68v16m-10-12h6m8 0h6m-20 5h6m8 0h6'} fill="none" strokeWidth="2" /></g>;
  if (kind === 'plug') return <path d="M72 63v7m10-7v7m-14 0h18v4q0 8-9 8v7m-9-19h18" fill="var(--mascot-paper)" />;
  if (kind === 'gear') return <g transform="translate(78 74)" fill="var(--mascot-grey)"><path d="M-4-13h8l1 5 5-1 4 7-4 4 1 5-7 4-4-4-5 1-4-7 4-4z" /><circle r="4" fill="var(--mascot-paper)" /></g>;
  if (kind === 'none') return null;
  return <path d={kind === 'check' ? 'M67 74l7 7 15-17' : 'M78 61l4 9 10 1-8 7 2 10-8-5-9 5 2-10-7-7 10-1z'} fill={kind === 'check' ? 'none' : 'var(--mascot-yellow)'} />;
}
export function Effects({ state }: { state: MascotState }) {
  if (state === 'error') return <path d="M88 35q-9 13 0 13t0-13" fill="var(--mascot-blue)" stroke="var(--mascot-outline)" strokeWidth="2" />;
  if (state === 'done' || state === 'success') return <path className="mascot-sparkle" d="M85 13l3 8 8 3-8 3-3 8-3-8-8-3 8-3zM12 58l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="var(--mascot-yellow)" />;
  if (state === 'typing') return <g className="mascot-dots" fill="var(--mascot-paper)"><circle cx="40" cy="84" r="2" /><circle cx="50" cy="84" r="2" /><circle cx="60" cy="84" r="2" /></g>;
  return <text className="mascot-effect" x="85" y="25" textAnchor="middle" fontSize={state === 'offline' ? 12 : 21} fontWeight="700" fill={state === 'attention' ? 'var(--need)' : 'var(--mascot-yellow)'}>{state === 'attention' ? '!!' : state === 'thinking' ? '?' : state === 'offline' ? 'Zzz' : ''}</text>;
}
