import { createServer } from "node:http";
import { parseMcpServers } from "../dist/mcp-external/config.js";
import { createMcpClient } from "../dist/mcp-external/client.js";

export async function remote(t, options = {}) {
  const received = []; let session = 0; let lost = false;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body); received.push({ message, headers: req.headers });
    const reply = (result, extra = {}) => {
      if (res.destroyed) return;
      const value = { jsonrpc: "2.0", id: message.id, result, ...extra };
      if (options.sse && message.id !== undefined) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(': keepalive\r\n\r\ndata: {"jsonrpc":"2.0","method":"notice"}\r\n\r\n');
        res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: -10, result: {} })}\r\n\r\n`);
        res.write(`data: ${JSON.stringify(value)}\r\n\r\n`);
        if (!options.openSse) res.end();
      } else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); }
    };
    if (message.method === "initialize") {
      session++; res.setHeader("Mcp-Session-Id", `session-${session}`);
      return reply({ protocolVersion: options.version ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } });
    }
    if (message.method === "notifications/initialized") { res.writeHead(202); res.end(); return; }
    if (options.loss && (!lost || options.loss === "always")) { lost = true; res.writeHead(404); res.end(); return; }
    if (options.respond) { const handled = await options.respond({ message, req, res, reply, received }); if (handled) return; }
    if (message.method === "tools/list") {
      const tools = options.tools ?? [{ name: "lookup", description: "Lookup reference data", inputSchema: { type: "object" } }];
      if (options.pages && !message.params.cursor) return reply({ tools: tools.slice(0, 1), nextCursor: "page2" });
      return reply({ tools: options.pages ? tools.slice(1) : tools });
    }
    if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
    reply(options.result ?? { content: [{ type: "text", text: "reference answer" }] });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const config = (extra = {}) => parseMcpServers({ servers: [{ name: "sample", url, ...extra }] }).servers[0];
  const client = (extra = {}, deps = {}) => { const c = createMcpClient(config(extra), deps); t.after(() => c.close()); return c; };
  return { received, config, client, url };
}
