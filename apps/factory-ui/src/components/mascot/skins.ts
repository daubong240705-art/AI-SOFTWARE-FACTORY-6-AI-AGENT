import { species, speciesList, type SpeciesDefinition, type Species } from './species';
export type MascotSkin = 'original' | 'classic' | 'forest' | 'ocean' | 'fantasy' | 'off';
export const seatNames = ['Lead', 'PM', 'BA', 'FE', 'BE', 'DevOps', 'Test', 'Researcher', 'Analyst', 'Fact Checker', 'Architect', 'Data Designer', 'API Designer', 'Architecture Reviewer', 'UX Designer', 'UI Designer', 'Design Reviewer'] as const;
type SeatMap = Record<string, SpeciesDefinition>;
const map = (values: Record<string, Species>): SeatMap => Object.fromEntries(Object.entries(values).map(([name, kind]) => [name, species[kind]]));
export const skins: Record<Exclude<MascotSkin, 'off' | 'original'>, SeatMap> = {
  classic: map({ Lead: 'chick', PM: 'cat', BA: 'glasses-cat', FE: 'rabbit', BE: 'bear', DevOps: 'raccoon', Test: 'penguin', Researcher: 'owl', Analyst: 'fox', 'Fact Checker': 'cat', Architect: 'bear', 'Data Designer': 'octopus', 'API Designer': 'raccoon', 'Architecture Reviewer': 'glasses-cat', 'UX Designer': 'rabbit', 'UI Designer': 'fox', 'Design Reviewer': 'penguin' }),
  forest: map({ Lead: 'deer', PM: 'fox', BA: 'owl', FE: 'rabbit', BE: 'bear', DevOps: 'raccoon', Test: 'owl', Researcher: 'owl', Analyst: 'fox', 'Fact Checker': 'deer', Architect: 'bear', 'Data Designer': 'owl', 'API Designer': 'raccoon', 'Architecture Reviewer': 'owl', 'UX Designer': 'rabbit', 'UI Designer': 'fox', 'Design Reviewer': 'deer' }),
  ocean: map({ Lead: 'whale', PM: 'whale', BA: 'octopus', FE: 'octopus', BE: 'shark', DevOps: 'shark', Test: 'penguin', Researcher: 'whale', Analyst: 'octopus', 'Fact Checker': 'shark', Architect: 'whale', 'Data Designer': 'octopus', 'API Designer': 'shark', 'Architecture Reviewer': 'whale', 'UX Designer': 'octopus', 'UI Designer': 'shark', 'Design Reviewer': 'penguin' }),
  fantasy: map({ Lead: 'unicorn', PM: 'wizard-cat', BA: 'wizard-cat', FE: 'unicorn', BE: 'dragon', DevOps: 'dragon', Test: 'unicorn', Researcher: 'wizard-cat', Analyst: 'unicorn', 'Fact Checker': 'wizard-cat', Architect: 'dragon', 'Data Designer': 'wizard-cat', 'API Designer': 'dragon', 'Architecture Reviewer': 'wizard-cat', 'UX Designer': 'unicorn', 'UI Designer': 'wizard-cat', 'Design Reviewer': 'dragon' }),
};
const accessoryBySeat: Record<string, SpeciesDefinition['accessory']> = { Lead: 'crown', PM: 'headset', BA: 'glasses', FE: 'brush', BE: 'laptop', DevOps: 'gear', Test: 'magnifier', Researcher: 'book', Analyst: 'chart', 'Fact Checker': 'magnifier', Architect: 'blueprint', 'Data Designer': 'database', 'API Designer': 'plug', 'Architecture Reviewer': 'check', 'UX Designer': 'pencil', 'UI Designer': 'palette', 'Design Reviewer': 'star' };
export function seatHash(name: string) { return Array.from(name).reduce((hash, letter) => ((hash * 31 + (letter.codePointAt(0) ?? 0)) >>> 0), 0); }
export function mascotDefinition(seat: string, skin: Exclude<MascotSkin, 'off'> = 'classic'): SpeciesDefinition {
  // 'original' is drawn from the operator's artwork (OriginalMascot); the coded classic set is its fallback.
  if (skin === 'original') skin = 'classic';
  const canonical = seatNames.find(name => name.toLowerCase() === seat.trim().toLowerCase());
  const fallback = speciesList[seatHash(seat) % speciesList.length] ?? 'blob';
  const value = (skins[skin] ?? skins.classic)[canonical ?? seat] ?? species[fallback];
  return { ...value, accessory: accessoryBySeat[canonical ?? seat] ?? value.accessory ?? 'none' };
}
