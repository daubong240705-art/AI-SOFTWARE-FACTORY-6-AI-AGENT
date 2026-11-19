import * as THREE from 'three';
import { colouredGeometry, type Piece } from '../props/geometry';
import type { Tool } from './store';
export const toyInk = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
const p = (color: string, at: Piece['at'], size: Piece['size'], shape: Piece['shape'] = 'box'): Piece => ({ color, at, size, shape });
/** One merged geometry / one draw per tool, including the whip's ten lash segments. */
export const toyModels: Record<Tool, THREE.BufferGeometry> = {
  whip: colouredGeometry([p('#79513D', [0, -0.16, 0], [0.09, 0.48, 0.09]), p('#FFD56A', [0, 0.08, 0], [0.13, 0.06, 0.13]), ...Array.from({ length: 10 }, (_, i) => p('#513B41', [0.12 + i * 0.14, 0.14, 0], [0.16, 0.035, 0.035]))]),
  taser: colouredGeometry([p('#34404B', [-0.18, 0, 0], [0.38, 0.28, 0.2]), p('#F5C74B', [-0.3, -0.22, 0], [0.13, 0.3, 0.16]), ...[-1, 1].map(s => p('#E2EDF2', [0.12, s * 0.09, 0], [0.26, 0.04, 0.05])), p('#71DCFA', [-0.18, 0.03, 0.105], [0.16, 0.1, 0.02])]),
  coffee: colouredGeometry([p('#FFF8E7', [0, 0, 0], [0.32, 0.34, 0.32], 'sphere'), p('#755137', [0, 0.14, 0], [0.24, 0.025, 0.24], 'sphere'), p('#FFF8E7', [0.2, 0, 0], [0.2, 0.23, 0.08], 'sphere'), p('#AFCFE6', [0.2, 0, 0.005], [0.1, 0.12, 0.085], 'sphere')]),
  hammer: colouredGeometry([p('#E7AE24', [0, -0.35, 0], [0.1, 0.85, 0.1]), p('#F58FB0', [0, 0.15, 0], [0.85, 0.4, 0.4]), ...[-1, 1].map(s => p('#FFD56A', [s * 0.45, 0.15, 0], [0.12, 0.46, 0.46], 'sphere'))]),
  feather: colouredGeometry([p('#FFF8E7', [0, 0, 0], [0.025, 0.85, 0.025]), ...[-1, 1].flatMap(s => Array.from({ length: 5 }, (_, i) => p(i % 2 ? '#D1B8EF' : '#F58FB0', [s * (0.11 - i * 0.015), -0.15 + i * 0.12, 0], [0.22 - i * 0.025, 0.22, 0.05], 'sphere')))]),
  megaphone: colouredGeometry([{ ...p('#F58FB0', [0, 0, 0], [0.48, 0.62, 0.48], 'cone'), roll: Math.PI / 2 }, p('#FFF8E7', [0.3, 0, 0], [0.045, 0.5, 0.5], 'sphere'), p('#59647C', [0.325, 0, 0], [0.025, 0.39, 0.39], 'sphere'), p('#79513D', [-0.15, -0.28, 0], [0.12, 0.35, 0.12])]),
  cookie: colouredGeometry([p('#DCA15D', [0, 0, 0], [0.43, 0.43, 0.12], 'sphere'), ...Array.from({ length: 7 }, (_, i) => p('#755137', [Math.sin(i * 2.4) * 0.14, Math.cos(i * 2.4) * 0.14, 0.055], [0.055, 0.045, 0.025], 'sphere'))]),
};
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
export const back = (n: number) => { const t = clamp(n) - 1; return 1 + 2.7 * t * t * t + 1.7 * t * t; };
