import { speciesList, type Species } from './species';

const prefix = 'mascot.';
export const mascotTag = (value: Species) => `${prefix}${value}`;
export const isMascotSpecies = (value: string): value is Species => (speciesList as readonly string[]).includes(value);
export const isMascotTag = (tag: string) => tag.startsWith(prefix) && isMascotSpecies(tag.slice(prefix.length));
export const speciesFromTags = (tags: readonly string[]) => {
  const value = tags.find(isMascotTag)?.slice(prefix.length);
  return value && isMascotSpecies(value) ? value : undefined;
};

export function mascotSeat(role: string, isLead = false): string {
  const normalized = role.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd');
  if (isLead || /\b(lead|leader|truong nhom)\b/.test(normalized)) return 'Lead';
  if (/\b(qa|qc|test|tests|tester|testing|kiem thu|kiem tra)\b/.test(normalized)) return 'Test';
  if (/\b(ux|ui|design|designer|thiet ke)\b/.test(normalized)) return 'UI Designer';
  if (/\b(devops|sre|ops|van hanh)\b/.test(normalized)) return 'DevOps';
  if (/\b(fe|front[ -]?end)\b/.test(normalized)) return 'FE';
  if (/\b(be|back[ -]?end|engineer|engineering|developer|dev|ky su|lap trinh)\b/.test(normalized)) return 'BE';
  if (/\b(research|researcher|nghien cuu)\b/.test(normalized)) return 'Researcher';
  if (/\b(ba|analyst|phan tich)\b/.test(normalized)) return 'Analyst';
  if (/\b(pm|manager|quan ly)\b/.test(normalized)) return 'PM';
  return normalized.trim() || 'agent';
}
