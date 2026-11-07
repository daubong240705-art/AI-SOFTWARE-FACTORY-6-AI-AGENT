import { parseEnv, startHost } from "./host.js";
import { createChatCompletionsGateway } from "./models/index.js";

try {
  const apiKey = process.env.NINE_ROUTER_API_KEY;
  const modelGateway = apiKey === undefined ? null : createChatCompletionsGateway({
    baseUrl: process.env.FACTORY_GATEWAY_URL ?? "https://ai.lazy.local/v1", apiKey,
  });
  const host = await startHost({ ...parseEnv(process.env), modelGateway, onBootstrapToken(token) {
    process.stdout.write(`One-time bootstrap token: ${token}\n`);
  } });
  process.stdout.write(`Factory Host listening on http://127.0.0.1:${host.port}\n`);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void host.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Host startup failed"}\n`);
  process.exitCode = 1;
}
