import { createServer } from "node:http";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { csvEscape, pathFromRoot } from "./lib.js";

const port = Number(process.env.PORT || 5173);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/feedback") {
      await handleFeedback(request, response);
      return;
    }
    serveStatic(request, response);
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: error.message }));
  }
}).listen(port, () => {
  console.log(`Finance news radar: http://localhost:${port}/public/index.html`);
});

async function handleFeedback(request, response) {
  const body = await readBody(request);
  const payload = JSON.parse(body || "{}");
  const file = pathFromRoot("data/feedback/news_feedback.csv");
  mkdirSync(dirname(file), { recursive: true });
  const line = [
    new Date().toISOString(),
    payload.news_id,
    payload.feedback,
    payload.rating,
    payload.title,
    payload.source,
    payload.url
  ].map(csvEscape).join(",");
  appendFileSync(file, `${line}\n`, "utf8");
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/public/index.html" : url.pathname;
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]/, "");
  const file = join(pathFromRoot(), relative);

  if (!file.startsWith(pathFromRoot()) || !existsSync(file)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": mimeTypes[extname(file)] || "application/octet-stream" });
  response.end(readFileSync(file));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}
