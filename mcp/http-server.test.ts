import { afterEach, describe, expect, it } from "vitest";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { createBunyaHttpServer } from "./http-server";
import { MAX_IMPORT_BYTES } from "../lib/graph/limits";

const servers: ReturnType<typeof createBunyaHttpServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function start() {
  const server = createBunyaHttpServer(); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}
async function send(port: number, headers: Record<string, string> = {}, body?: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: body === undefined ? "/health" : "/mcp", method: body === undefined ? "GET" : "POST", headers }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    req.on("error", reject); req.end(body);
  });
}
describe("HTTP boundary", () => {
  it("rejects malformed/rebound Hosts and untrusted origins without killing service", async () => {
    const port = await start();
    expect(await send(port, { host: "[" })).toBe(403);
    expect(await send(port, { host: "attacker.example" })).toBe(403);
    expect(await send(port, { origin: "https://attacker.example" })).toBe(403);
    expect(await send(port)).toBe(200);
  });
  it("rejects oversized and malformed JSON and remains healthy", async () => {
    const port = await start();
    expect(await send(port, { "content-type": "application/json", "content-length": String(MAX_IMPORT_BYTES + 1) }, "{}")).toBe(413);
    expect(await send(port, { "content-type": "application/json" }, "{")).toBe(400);
    expect(await send(port)).toBe(200);
  });
  it("serves a valid stateless MCP initialize request", async () => {
    const port = await start();
    expect(await send(port, { "content-type": "application/json", accept: "application/json, text/event-stream" }, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }))).toBe(200);
  });
});
