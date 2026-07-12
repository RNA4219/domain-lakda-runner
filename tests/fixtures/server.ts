import { createServer, type Server } from "node:http";

export async function startFixture(handler?: (requestUrl: URL, method: string, body: string) => { status?: number; body?: string; contentType?: string } | undefined): Promise<{ server: Server; baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const custom = handler?.(url, request.method ?? "GET", Buffer.concat(chunks).toString("utf8"));
    const status = custom?.status ?? (url.pathname === "/failure" ? 500 : 200);
    const body = custom?.body ?? `<html><body><h1>${url.pathname}</h1></body></html>`;
    response.writeHead(status, { "content-type": custom?.contentType ?? "text/html" }); response.end(body);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture address unavailable");
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, close: async () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
