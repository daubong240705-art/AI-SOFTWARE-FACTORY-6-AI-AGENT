export function formatRequestUsage(used: number, limit: number): string {
  const safeUsed = Number.isFinite(used) ? Math.max(0, Math.floor(used)) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  return `${safeUsed}/${safeLimit} request`;
}
