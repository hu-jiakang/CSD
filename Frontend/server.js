const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3003);
const BACKEND = process.env.BACKEND_URL || "http://localhost:3002";
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function sendFile(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    fs.createReadStream(filePath).pipe(res);
  });
}

function proxyApi(req, res) {
  const target = new URL(req.url, BACKEND);

  if (new URL(req.url, "http://localhost").pathname === "/api/customer-stores/export" && req.method === "POST") {
    let body = "";
    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        let payload = {};
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          const params = new URLSearchParams(body);
          payload = { token: params.get("token") || "" };
        }
        const token = String(payload.token || "").trim();

        if (!token) {
          res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "Authentication required." }));
          return;
        }

        const headers = {
          ...req.headers,
          host: target.host,
          authorization: `Bearer ${token}`,
          "content-length": "0"
        };

        delete headers["content-type"];

        const proxyReq = http.request(
          {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || 80,
            path: target.pathname + target.search,
            method: "GET",
            headers
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );

        proxyReq.on("error", (err) => {
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: `Backend unavailable: ${err.message}` }));
        });

        proxyReq.end();
      } catch {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: "Invalid export request." }));
      }
    });

    return;
  }

  const headers = { ...req.headers, host: target.host };
  const proxyReq = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: `Backend unavailable: ${err.message}` }));
  });
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/") || req.url === "/api") {
    proxyApi(req, res);
    return;
  }

  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === "/") pathname = "/index.html";

  const normalized = path.normalize(pathname).replace(/^(\.\.[\\/])+/, "");
  const filePath = path.join(ROOT, normalized);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Customer and Store Dashboard frontend running at http://localhost:${PORT}/`);
  console.log(`API proxy: /api -> ${BACKEND}/api`);
});
