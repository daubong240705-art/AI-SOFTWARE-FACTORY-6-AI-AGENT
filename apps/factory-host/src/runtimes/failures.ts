// Only these adapter-owned messages may reach the operator. Never persist raw CLI errors.
export const LOCAL_CLI_FAILURES = new Set([
  "runtime unavailable", "local CLI: workspace unavailable", "local CLI: configuration invalid",
  ...["codex", "claude"].flatMap((cli) => [
    `${cli}: not installed on the Host machine.`,
    `${cli}: not logged in. Run ${cli === "codex" ? "codex login" : "claude auth login"} on the Host machine.`,
    `${cli}: quota or rate limit reached. Check usage on the Host machine.`,
    `${cli}: execution failed.`, `${cli}: timed out.`, `${cli}: output limit exceeded.`,
  ]),
]);
