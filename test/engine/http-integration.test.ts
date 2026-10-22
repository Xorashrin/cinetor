import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { engine, source, mp4 } from "./helpers";
import type { Transport } from "../../src/engine/network";
test("local authorized HTTP integration: real socket, redirect, JSON, range probe, catalog and offline cache", async () => {
  let range: string | undefined;
  const server = createServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { Location: "/catalog" });
      res.end();
      return;
    }
    if (req.url === "/catalog") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          items: [
            {
              title: "বাংলা Film",
              url: "/film.mp4",
              kind: "movie",
              category: "home",
              year: 2024,
              language: "bn",
            },
          ],
        }),
      );
      return;
    }
    if (req.url === "/film.mp4") {
      range = req.headers.range;
      res.writeHead(206, {
        "Content-Type": "video/mp4",
        "Content-Range": "bytes 0-31/1000000",
      });
      res.end(mp4());
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const s = source({
    endpoint: origin + "/start",
    protocol: "http",
    allowPrivateNetwork: true,
    scopes: [{ origin, pathPrefix: "/" }],
  });
  const transport: Transport = async (url, init) => {
    const r = await fetch(url, init);
    return {
      status: r.status,
      headers: r.headers,
      body: r.body
        ? {
            getReader: () => {
              const reader = r.body!.getReader();
              return {
                read: async () => {
                  const p = await reader.read();
                  return { done: !!p.done, value: p.value };
                },
                cancel: () => reader.cancel(),
              };
            },
          }
        : null,
    };
  };
  try {
    const e = await engine(transport, [s]);
    await e.scheduler.run("foreground");
    assert.equal(e.catalog.query("home").length, 1);
    assert.equal(range, "bytes=0-4095");
    assert.equal(e.diagnostics.value.successful, 1);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    assert.equal(e.catalog.query("home")[0].title, "বাংলা Film");
  } finally {
    if (server.listening) server.close();
  }
});
