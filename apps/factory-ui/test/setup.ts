import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { i18n } from '../src/i18n';

export function useEnglish() { i18n.setLocale('en'); }
beforeEach(() => { if (typeof window !== 'undefined') { useEnglish(); history.replaceState(null, '', '/'); } });

afterEach(() => cleanup());
