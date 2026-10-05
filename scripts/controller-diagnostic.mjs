// Local-only, dependency-free page. The browser downloads reports at the user's request.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const server = createServer(async (req, res) => {
  if (req.method !== "GET" || req.url !== "/") {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(await readFile(new URL("./controller-diagnostic.html", import.meta.url)));
});
server.listen(Number(process.argv[2] ?? 0), "127.0.0.1", () =>
  console.log(`Controller check: http://127.0.0.1:${server.address().port}/ (Ctrl-C to stop)`),
);
