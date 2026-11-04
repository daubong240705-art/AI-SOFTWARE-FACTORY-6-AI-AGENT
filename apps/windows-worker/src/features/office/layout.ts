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

// Keep HTML text readable independently of the room's camera scale.
export function placeOfficeLabels(
  items: (OfficeProjection & { width: number; height: number })[],
  width: number,
  height: number,
) {
  const placed: { left: number; top: number; width: number; height: number }[] =
    [];
  return [...items]
    .sort((a, b) => a.y - b.y)
    .map((item) => {
      const left = Math.max(
        4,
        Math.min(width - item.width - 4, item.x - item.width / 2),
      );
      const initial = Math.max(
        4,
        Math.min(height - item.height - 4, item.y - item.height),
      );
      const candidates = [
        initial,
        ...placed.flatMap((p) => [
          p.top + p.height + 4,
          p.top - item.height - 4,
        ]),
      ].sort((a, b) => Math.abs(a - initial) - Math.abs(b - initial));
      const top = candidates.find(
        (y) =>
          y >= 4 &&
          y + item.height <= height - 4 &&
          placed.every(
            (p) =>
              left + item.width + 4 <= p.left ||
              left >= p.left + p.width + 4 ||
              y + item.height + 4 <= p.top ||
              y >= p.top + p.height + 4,
          ),
      );
      const visible = item.visible && top !== undefined;
      if (visible)
        placed.push({ left, top, width: item.width, height: item.height });
      return {
        ...item,
        x: left + item.width / 2,
        y: (top ?? initial) + item.height,
        visible,
      };
    });
}
