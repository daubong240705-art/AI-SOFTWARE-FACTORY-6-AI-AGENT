import type { SpeciesDefinition } from './species';
export function Animal({ definition: { species, ear, fill, accent } }: { definition: SpeciesDefinition }) {
  return <>
    {ear === 'pointed' && <path d="M23 40L20 17q1-6 7-2l17 16M77 40l3-23q-1-6-7-2L56 31" fill={fill} />}
    {ear === 'round' && <g fill={fill}><circle cx="24" cy="33" r="12" /><circle cx="76" cy="33" r="12" /></g>}
    {ear === 'long' && <path d="M29 38C15 12 27-3 35 10l7 28M58 38l7-28c8-13 20 2 6 28" fill={fill} />}
    {species === 'deer' && <path d="M31 28L26 7m0 10-9-5m9 0 5-6M69 28l5-21m0 10 9-5m-9 0-5-6" fill="none" />}
    {ear === 'fin' && <path d="M45 32L58 7l6 27" fill={fill} />}
    {species === 'dragon' && <path d="M22 54L9 42l3 23 15 6M78 54l13-12-3 23-15 6" fill={fill} />}
    {species === 'whale' && <path d="M77 62q16 4 17-13l-12 4-3-11-6 14M45 26q-8-15-16-10m16 10q1-18 12-19" fill={fill} />}
    {species === 'octopus' && <path d="M20 64q-15 22-4 23 8 0 13-9 0 18 10 13l9-12q4 22 14 9l5-11q17 17 18 3l-8-16" fill={fill} />}
    <path d="M16 48C16 27 30 22 50 22s34 5 34 26v12c0 19-15 27-34 27S16 79 16 60z" fill={fill} />
    {['penguin', 'owl', 'raccoon', 'fox', 'shark'].includes(species) && <path d="M23 48q4-23 27-9 23-14 27 9v12q0 22-27 22T23 60z" fill={accent} stroke="none" />}
    {species === 'raccoon' && <path d="M27 40q10-8 21 2l2 9q-14 11-24-1zm46 0q-10-8-21 2l-2 9q14 11 24-1z" fill={fill} stroke="none" />}
    {species === 'owl' && <g fill={accent}><circle cx="37" cy="47" r="14" /><circle cx="63" cy="47" r="14" /></g>}
    {species === 'bear' && <ellipse cx="50" cy="64" rx="14" ry="10" fill={accent} stroke="none" />}
    {['chick', 'penguin', 'owl'].includes(species) && <path d="M44 57l6 7 6-7z" fill="var(--mascot-yellow)" />}
    {species === 'unicorn' && <path d="M43 25L51 4l8 22M25 28q-10 21 1 29" fill="var(--mascot-yellow)" />}
    {species === 'dragon' && <path d="M33 24l8-9 9 9 9-9 8 9" fill="var(--mascot-yellow)" />}
    {species === 'wizard-cat' && <path d="M24 26L48 3l9 22 19 5q-28 10-54 0z" fill="var(--mascot-lavender)" />}
  </>;
}
