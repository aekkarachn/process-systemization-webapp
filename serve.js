// Tiny static file server for the webapp.
// Usage: node serve.js  (then open http://localhost:5173)
// No external dependencies — pure Node.

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 5173;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
};

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(url.parse(req.url).pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  // Prevent path traversal
  const safe = path.normalize(pathname).replace(/^([\/\\])+/, "");
  const full = path.join(ROOT, safe);
  if (!full.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found: " + pathname);
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(full).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT}`);
  console.log(`Open http://localhost:${PORT}`);
});
