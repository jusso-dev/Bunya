// Serves the static export in out/ at /Bunya/, the way GitHub Pages does, for
// local verification only. Loopback only; anything outside /Bunya/ is a 404 so
// a missing base path fails loudly. Usage: node scripts/serve-pages.mjs --port 3190
import { createServer } from "node:http";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const BASE = "/Bunya/";
const root = resolve(process.cwd(), "out");
const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT ?? 3190);

if (!existsSync(join(root, "index.html"))) {
  console.error("out/index.html not found. Run `pnpm build:pages` first.");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function notFound(response) {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === BASE.slice(0, -1)) {
      response.writeHead(301, { location: BASE });
      response.end();
      return;
    }
    if (!pathname.startsWith(BASE)) return notFound(response);
    const relative = decodeURIComponent(pathname.slice(BASE.length));
    let file = resolve(root, relative);
    if (file !== root && !file.startsWith(root + sep)) return notFound(response);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) || !statSync(file).isFile()) return notFound(response);
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Bad request");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving out/ at http://127.0.0.1:${port}${BASE}`);
});
