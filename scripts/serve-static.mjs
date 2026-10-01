// Local stand-in for the Vercel deployment: serves dist/site with the same /game SPA
// fallback as vercel.json.  Usage: npm run build && npm run serve:static  (port 4173)
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = "dist/site";
const port = Number(process.env.PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (path === "/") {
    res.writeHead(307, { location: "/game/" }).end();
    return;
  }
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  // SPA fallback: anything under /game that isn't a file gets the app shell
  if (!existsSync(file) && (path === "/game" || path.startsWith("/game/")))
    file = join(root, "game/index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, process.env.HOST ?? "127.0.0.1", () =>
  console.log(`serving ${root} at http://localhost:${port}/game/`),
);
