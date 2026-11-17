import type { createApiClient } from '@/api/client';

// client.ts keeps `base` private. Match its trailing-slash normalization and the
// store/useWorldData default, without creating a client or making an HTTP read.
type ClientOptions = NonNullable<Parameters<typeof createApiClient>[0]>;
export function thumbnailUrl(
  projectId: string, releaseId: string,
  baseUrl: ClientOptions['baseUrl'] = import.meta.env.DEV ? '/api' : '',
): string | null {
  const base = baseUrl.replace(/\/$/, '');
  const path = `${base}/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}/thumbnail`;
  if (typeof window === 'undefined') return path.startsWith('/') && !path.startsWith('//') ? path : null;
  try {
    const url = new URL(path, window.location.href);
    return url.origin === window.location.origin && /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}
