const paths = {
  overview: 'M3 11 12 3l9 8v10H3Z', attention: 'M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6Z',
  team: 'M2 21c0-4 3-6 7-6s7 2 7 6M17 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  settings: 'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  collapse: 'm15 5-7 7 7 7', expand: 'm9 5 7 7-7 7', menu: 'M4 6h16M4 12h16M4 18h16', close: 'm6 6 12 12M18 6 6 18', plus: 'M12 4v16M4 12h16',
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
