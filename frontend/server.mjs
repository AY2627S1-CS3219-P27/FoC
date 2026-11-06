import { createServer } from "node:http";
import next from "next";
import httpProxy from "http-proxy";

const production = process.argv.includes("--production");
const hostname = process.env.FRONTEND_HOSTNAME ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const socketPath = normalizeSocketPath(process.env.SOCKET_PATH ?? "/socket.io");
const commsServiceUrl = new URL(process.env.COMMS_SERVICE_URL ?? "http://localhost:3006");

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port");
}
if (commsServiceUrl.protocol !== "http:" && commsServiceUrl.protocol !== "https:") {
  throw new Error("COMMS_SERVICE_URL must use HTTP or HTTPS");
}

const app = next({
  dev: !production,
  hostname,
  port,
});
await app.prepare();

const handleRequest = app.getRequestHandler();
const handleNextUpgrade = app.getUpgradeHandler();
const socketProxy = httpProxy.createProxyServer({
  target: commsServiceUrl.origin,
  ws: true,
  changeOrigin: true,
  xfwd: true,
});

socketProxy.on("error", (error, _request, responseOrSocket) => {
  console.error("Socket proxy failed", error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN");
  if (responseOrSocket && "destroy" in responseOrSocket) {
    responseOrSocket.destroy();
  }
});

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", "http://frontend.local").pathname;
  if (pathname === socketPath || pathname.startsWith(`${socketPath}/`)) {
    socketProxy.ws(request, socket, head);
    return;
  }
  void handleNextUpgrade(request, socket, head);
});

server.listen(port, hostname, () => {
  console.log(`Frontend ready on http://${hostname}:${port}`);
});

async function shutdown() {
  socketProxy.close();
  server.close();
  await app.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

function normalizeSocketPath(value) {
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) {
    throw new Error("SOCKET_PATH must be an absolute URL path");
  }
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}
