/** The preview page starts a match against bots at once with ?autoplay=bot (starter dev/host.ts). */
export function withBotAutoplay(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}autoplay=bot`;
}
