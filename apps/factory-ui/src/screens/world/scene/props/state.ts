export const propIds = ['server-rack', 'aquarium', 'office-cat', 'oiia-cat', 'coffee-machine', 'ping-pong-table', 'day-night-window', 'swaying-plants', 'standing-fan', 'neon-sign'] as const;
export function daylight(date: Date): 'day' | 'sunset' | 'night' {
  const hour = date.getHours();
  return hour >= 6 && hour < 17 ? 'day' : hour >= 17 && hour < 19 ? 'sunset' : 'night';
}
let pettable = false;
export const catCanBePetted = () => pettable;
export function setCatPettable(value: boolean) { pettable = value; }
