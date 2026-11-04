import type { Role } from "../../../shared/contracts";

export const officeSeats: {
  role: Role;
  x: number;
  z: number;
  color: string;
}[] = [
  { role: "lead", x: 0, z: -4.3, color: "#fa8c69" },
  { role: "pm", x: -4.2, z: -0.4, color: "#b4a3d9" },
  { role: "ba", x: 0, z: -0.4, color: "#c9b482" },
  { role: "be", x: 4.2, z: -0.4, color: "#83b9d5" },
  { role: "fe", x: -4.2, z: 3.8, color: "#88bfa3" },
  { role: "test", x: 0, z: 3.8, color: "#a5b9d8" },
  { role: "devops", x: 4.2, z: 3.8, color: "#c5a28e" },
];
export function officeZoom(width: number, height: number, scale = 1) {
  return (
    Math.max(1, Math.min(width / 25, height / 20)) *
    Math.max(0.7, Math.min(2.4, scale))
  );
}
export function clampOfficePan(value: number) {
  return Math.max(-3, Math.min(3, value));
}
export type OfficeProjection = {
  role: Role;
  x: number;
  y: number;
  visible: boolean;
};
