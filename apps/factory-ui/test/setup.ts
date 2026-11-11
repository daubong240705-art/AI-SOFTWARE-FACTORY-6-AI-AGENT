import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { i18n } from '../src/i18n';

if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

export function useEnglish() { i18n.setLocale('en'); }
beforeEach(() => { if (typeof window !== 'undefined') { useEnglish(); history.replaceState(null, '', '/'); } });

afterEach(() => cleanup());
