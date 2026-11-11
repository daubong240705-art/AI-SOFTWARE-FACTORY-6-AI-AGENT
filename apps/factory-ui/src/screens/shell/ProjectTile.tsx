import type { CSSProperties } from 'react';

export const projectHues = ['var(--p-1)', 'var(--p-2)', 'var(--p-3)', 'var(--p-4)'] as const;
export function projectHue(id: string): typeof projectHues[number] {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return projectHues[hash % projectHues.length]!;
}
export function ProjectTile({ id, name }: { id: string; name: string }) {
  const words = name.trim().split(/\s+/);
  const code = (words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : name.slice(0, 2)).toLocaleUpperCase();
  return <span aria-hidden="true" className="project-tile" style={{ '--project-hue': projectHue(id) } as CSSProperties}>{code}</span>;
}
