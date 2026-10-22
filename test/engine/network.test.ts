import { test } from "node:test";
import assert from "node:assert/strict";
import { source, network, response } from "./helpers";
import { EngineError } from "../../src/engine/model";
const signal = () => new AbortController().signal;
for (const [status, code] of [
  [401, "authentication"],
  [403, "permission"],
  [429, "rate-limit"],
  [404, "unsupported"],
] as const)
  test("HTTP " + status + " is isolated without repeated retries", async () => {
    let calls = 0;
    const net = network(async () => {
      calls++;
      return response("", status);
    });
    await assert.rejects(
      net.request(source({ retries: 3 }), source().endpoint, signal()),
      { code },
    );
    assert.equal(calls, 1);
  });
test("simulated ISP A succeeds while ISP B DNS fails; retries bounded", async () => {
  let isp = "A",
    calls = 0;
  const net = network(async () => {
    calls++;
    if (isp === "B") throw new Error("DNS ENOTFOUND secret");
    return response("[]");
  });
  await net.request(source(), source().endpoint, signal());
  isp = "B";
  await assert.rejects(net.request(source(), source().endpoint, signal()), {
    code: "network",
  });
  assert.equal(calls, 3);
});
test("retry exponential backoff, jitter and exhaustion", async () => {
  const waits: number[] = [];
  let calls = 0;
  const net = network(
    async () => {
      calls++;
      throw new Error("reset");
    },
    async () => true,
    {
      random: () => 0,
      sleep: async (ms) => {
        if (ms >= 300) waits.push(ms);
      },
    },
  );
  await assert.rejects(
    net.request(source({ retries: 3 }), source().endpoint, signal()),
    { code: "network" },
  );
  assert.equal(calls, 4);
  assert(waits.includes(300));
  assert(waits.includes(600));
  assert(waits.includes(1200));
});
test("temporary connection error then success", async () => {
  let calls = 0;
  const net = network(async () => {
    if (calls++ === 0) throw new Error("reset");
    return response("[]");
  });
  assert.equal(
    (await net.request(source(), source().endpoint, signal())).status,
    200,
  );
  assert.equal(calls, 2);
});
test("offline avoids source requests", async () => {
  let calls = 0;
  const net = network(
    async () => {
      calls++;
      return response("[]");
    },
    async () => false,
  );
  await assert.rejects(net.request(source(), source().endpoint, signal()), {
    code: "offline",
  });
  assert.equal(calls, 0);
});
test("bounded native request timeout aborts a slow response", async () => {
  let aborted = false;
  const net = network(
    async (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error());
          },
          { once: true },
        ),
      ),
  );
  await assert.rejects(
    net.request(
      source({ timeoutMs: 500, retries: 0 }),
      source().endpoint,
      signal(),
    ),
    { code: "timeout" },
  );
  assert(aborted);
});
test("connectivity change cancels active request", async () => {
  const ctrl = new AbortController();
  const net = network(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error()), {
          once: true,
        });
        ctrl.abort();
      }),
  );
  await assert.rejects(net.request(source(), source().endpoint, ctrl.signal), {
    code: "cancelled",
  });
});
test("pre-cancelled request does not fetch", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let calls = 0;
  await assert.rejects(
    network(async () => {
      calls++;
      return response("[]");
    }).request(source(), source().endpoint, ctrl.signal),
    { code: "cancelled" },
  );
  assert.equal(calls, 0);
});
test("oversized declared and chunked bodies rejected", async () => {
  for (const headers of [{}, { "content-length": "900000" }])
    await assert.rejects(
      network(async () =>
        response("x".repeat(2048), 200, "application/json", headers),
      ).request(
        source({ maxResponseBytes: 1024 }),
        source().endpoint,
        signal(),
      ),
      { code: "size" },
    );
});
test("range probe cancels large response without complete download", async () => {
  let read = 0,
    cancel = 0;
  const net = network(async () => ({
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          read++;
          return { done: false, value: new Uint8Array(4096) };
        },
        cancel: async () => {
          cancel++;
        },
      }),
    },
  }));
  const r = await net.request(source(), source().endpoint, signal(), {
    limit: 64,
    prefix: true,
    expectedTypes: [""],
  });
  assert.equal(r.bytes.length, 64);
  assert.equal(read, 1);
  assert.equal(cancel, 1);
});
test("no streaming support is rejected rather than arrayBuffer fallback", async () =>
  await assert.rejects(
    network(async () => ({
      status: 200,
      headers: { get: () => "application/json" },
      body: null,
    })).request(source(), source().endpoint, signal()),
    { code: "unsupported" },
  ));
test("wrong response type rejected", async () =>
  await assert.rejects(
    network(async () => response("<html/>", 200, "text/html")).request(
      source(),
      source().endpoint,
      signal(),
    ),
    { code: "malformed" },
  ));
test("manual same-origin redirect supported", async () => {
  const urls: string[] = [];
  const net = network(async (url, init) => {
    urls.push(url);
    assert.equal(init.redirect, "manual");
    return urls.length === 1
      ? response("", 302, "application/json", { location: "/other.json" })
      : response("[]");
  });
  await net.request(source(), source().endpoint, signal());
  assert.equal(urls[1], "https://media.example/other.json");
});
test("redirect to arbitrary host is rejected before request", async () => {
  let calls = 0;
  const net = network(async () => {
    calls++;
    return response("", 302, "application/json", {
      location: "https://evil.example/a",
    });
  });
  await assert.rejects(net.request(source(), source().endpoint, signal()), {
    code: "scope",
  });
  assert.equal(calls, 1);
});
test("authorization never forwarded to another allowed origin", async () => {
  let calls = 0;
  const net = network(
    async (_url, init) => {
      calls++;
      assert.equal(init.headers.Authorization, "Bearer secret");
      return response("", 302, "application/json", {
        location: "https://cdn.example/a",
      });
    },
    async () => true,
    { credentials: async () => ({ Authorization: "Bearer secret" }) },
  );
  const s = source({
    authRef: "media-auth",
    scopes: [
      { origin: "https://media.example", pathPrefix: "/" },
      { origin: "https://cdn.example", pathPrefix: "/" },
    ],
  });
  await assert.rejects(net.request(s, s.endpoint, signal()), { code: "scope" });
  assert.equal(calls, 1);
});
test("HTTPS downgrade rejected and redirect loops bounded", async () => {
  const s = source({
    scopes: [
      { origin: "https://media.example", pathPrefix: "/" },
      { origin: "http://media.example", pathPrefix: "/" },
    ],
  });
  await assert.rejects(
    network(async () =>
      response("", 302, "application/json", {
        location: "http://media.example/a",
      }),
    ).request(s, s.endpoint, signal()),
    { code: "scope" },
  );
  let calls = 0;
  await assert.rejects(
    network(async () => {
      calls++;
      return response("", 302, "application/json", { location: "/loop" });
    }).request(source(), source().endpoint, signal()),
    { code: "scope" },
  );
  assert.equal(calls, 4);
});
test("authentication configuration failure remains a safe code", async () => {
  const net = network(
    async () => response("[]"),
    async () => true,
    {
      credentials: async () => {
        throw new EngineError("authentication");
      },
    },
  );
  await assert.rejects(
    net.request(source({ authRef: "secure" }), source().endpoint, signal()),
    { message: "authentication" },
  );
});
test("deadline also bounds transport that ignores AbortSignal", async () => {
  const net = network(async () => new Promise(() => {}));
  await assert.rejects(
    net.request(
      source({ timeoutMs: 500, retries: 0 }),
      source().endpoint,
      signal(),
    ),
    { code: "timeout" },
  );
});
test("deadline bounds stalled body stream", async () => {
  const net = network(async () => ({
    status: 200,
    headers: { get: () => "application/json" },
    body: {
      getReader: () => ({
        read: async () => new Promise(() => {}),
        cancel: async () => {},
      }),
    },
  }));
  await assert.rejects(
    net.request(
      source({ timeoutMs: 500, retries: 0 }),
      source().endpoint,
      signal(),
    ),
    { code: "timeout" },
  );
});
test("authentication attached only to configured endpoint origin", async () => {
  const s = source({
    authRef: "secure",
    scopes: [
      { origin: "https://media.example", pathPrefix: "/" },
      { origin: "https://cdn.example", pathPrefix: "/" },
    ],
  });
  const net = network(
    async (_url, init) => {
      assert.equal(init.headers.Authorization, undefined);
      return response("[]");
    },
    async () => true,
    { credentials: async () => ({ Authorization: "Bearer secret" }) },
  );
  await net.request(s, "https://cdn.example/a", signal());
});
