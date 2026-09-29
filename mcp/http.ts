import { createBunyaHttpServer } from "./http-server";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const allowedHosts = process.env.BUNYA_ALLOWED_HOSTS?.split(",").map((value) => value.trim()).filter(Boolean);
const allowedOrigins = process.env.BUNYA_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean);

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !allowedHosts?.length) {
  throw new Error("Remote binding requires BUNYA_ALLOWED_HOSTS and an authenticated TLS proxy.");
}
createBunyaHttpServer({ allowedHosts, allowedOrigins }).listen(port, host, () => {
  console.error(`Bunya MCP HTTP server listening on http://${host}:${port}/mcp`);
});
