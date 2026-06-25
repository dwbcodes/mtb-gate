import { createServer } from "node:http";
import { InMemoryAttemptStore } from "./store.ts";
import { getResults, getRoster, postAttempts } from "./handlers.ts";

const store = new InMemoryAttemptStore();
const host = process.env.MTB_GATE_API_HOST ?? "127.0.0.1";
const port = Number(process.env.MTB_GATE_API_PORT ?? "8787");

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/roster") {
    const result = await getRoster(store);
    response.writeHead(result.statusCode, result.headers);
    response.end(result.body);
    return;
  }

  if (request.method === "GET" && url.pathname === "/results") {
    const result = await getResults(url, store);
    response.writeHead(result.statusCode, result.headers);
    response.end(result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/attempts") {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const result = await postAttempts(Buffer.concat(chunks).toString("utf8"), store);
      response.writeHead(result.statusCode, result.headers);
      response.end(result.body);
    });
    return;
  }

  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, host, () => {
  console.log(`MTB Gate dev API listening on http://${host}:${port}`);
});
