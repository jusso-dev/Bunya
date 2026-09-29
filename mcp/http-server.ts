import { createServer, type IncomingMessage } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MAX_IMPORT_BYTES, checkObjectDepth } from "../lib/graph/limits";
import { createBunyaMcpServer } from "./create-server";

async function readBody(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_IMPORT_BYTES) throw new Error("body-too-large");
    chunks.push(Buffer.from(chunk));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  checkObjectDepth(parsed);
  return parsed;
}

export function createBunyaHttpServer(options: { allowedHosts?: string[]; allowedOrigins?: string[] } = {}) {
  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (request, response) => {
    const reply = (status: number, message: string) => {
      if (response.headersSent || response.destroyed) return;
      response.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff", connection: "close" });
      response.end(JSON.stringify({ error: message }));
    };
    let server: ReturnType<typeof createBunyaMcpServer> | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    try {
      const host = request.headers.host;
      const localHosts = ["localhost", "127.0.0.1", "[::1]"];
      const validHost = host && (options.allowedHosts?.includes(host) || localHosts.some((name) => host === name || host === `${name}:${request.socket.localPort}`));
      if (!validHost) { reply(403, "Host is not allowed."); return; }
      if (request.headers.origin && !options.allowedOrigins?.includes(request.headers.origin)) { reply(403, "Origin is not allowed."); return; }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, service: "bunya-mcp" }));
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/mcp") { reply(404, "Use POST /mcp or GET /health."); return; }
      if (!request.headers["content-type"]?.startsWith("application/json")) { reply(415, "Use application/json."); return; }
      if (Number(request.headers["content-length"]) > MAX_IMPORT_BYTES) { reply(413, "Request exceeds 1 MiB."); return; }
      let body: unknown;
      try { body = await readBody(request); }
      catch (error) { reply(error instanceof Error && error.message === "body-too-large" ? 413 : 400, "Invalid or oversized JSON body."); return; }
      server = createBunyaMcpServer();
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      reply(500, "Internal server error.");
    } finally {
      await Promise.allSettled([transport?.close(), server?.close()]);
    }
  });
}
