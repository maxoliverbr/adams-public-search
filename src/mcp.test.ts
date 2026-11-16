import { afterEach, describe, expect, test } from "bun:test";
import { app } from "./index";

const doc = { AccessionNumber: "ML1", DocumentTitle: "T", content: "BIG" };
const searchRes = { count: 1, results: [{ score: 0.5, document: doc }], facets: null };

let calls: { url: string; init: RequestInit }[] = [];
const realFetch = globalThis.fetch;
function mock(body: unknown, status = 200) {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status });
  }) as any;
}
afterEach(() => (globalThis.fetch = realFetch));

const send = (raw: string, method = "POST") =>
  app.handle(new Request("http://localhost/mcp", { method, headers: { "content-type": "application/json" }, ...(method === "POST" ? { body: raw } : {}) }));
const rpc = (body: unknown) => send(JSON.stringify(body));
const call = async (name: string, args?: unknown): Promise<any> =>
  (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json();
const sentBody = () => JSON.parse(calls[0]!.init.body as string);

describe("lifecycle", () => {
  test("initialize returns version, tools capability, serverInfo, and echoes id", async () => {
    const r: any = await (await rpc({ jsonrpc: "2.0", id: "abc", method: "initialize" })).json();
    expect(r).toMatchObject({ jsonrpc: "2.0", id: "abc", result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "adams-public-search" } } });
  });
  test("ping returns empty result", async () => {
    expect(await (await rpc({ jsonrpc: "2.0", id: 2, method: "ping" })).json()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });
  test("notifications get 202 and no body", async () => {
    const r = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.status).toBe(202);
    expect(await r.text()).toBe("");
  });
  test("unknown method -> -32601", async () => {
    const r: any = await (await rpc({ jsonrpc: "2.0", id: 3, method: "resources/list" })).json();
    expect(r.error.code).toBe(-32601);
  });
});

describe("transport", () => {
  test("invalid JSON -> 400 -32600", async () => {
    const r = await send("{nope");
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe(-32600);
  });
  test("batch arrays are rejected", async () => {
    const r = await send(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]));
    expect(r.status).toBe(400);
  });
  test("GET /mcp -> 405 with Allow: POST", async () => {
    const r = await send("", "GET");
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("POST");
  });
  test("/mcp is hidden from the OpenAPI spec", async () => {
    const spec: any = await (await app.handle(new Request("http://localhost/openapi/json"))).json();
    expect(spec.paths["/mcp"]).toBeUndefined();
  });
});

describe("tools/list", () => {
  test("lists both tools with JSON Schema inputs", async () => {
    const r: any = await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
    const tools = r.result.tools;
    expect(tools.map((t: any) => t.name)).toEqual(["search_documents", "get_document"]);
    for (const t of tools) {
      expect(t.description).toBeString();
      expect(t.inputSchema.type).toBe("object");
    }
    expect(Object.keys(tools[0].inputSchema.properties)).toContain("docket");
    expect(tools[1].inputSchema.required).toEqual(["accession"]);
  });
});

describe("tools/call search_documents", () => {
  test("builds upstream body from args and returns JSON text without content", async () => {
    mock(searchRes);
    const r = await call("search_documents", { q: "reactor", docket: "05000390", library: "main" });
    expect(sentBody()).toMatchObject({ q: "reactor", filters: [{ field: "DocketNumber", value: "05000390", operator: "equals" }], legacyLibFilter: false });
    expect(r.result.isError).toBe(false);
    expect(r.result.content[0].type).toBe("text");
    const out = JSON.parse(r.result.content[0].text);
    expect(out.count).toBe(1);
    expect(out.results[0]).toMatchObject({ score: 0.5, AccessionNumber: "ML1" });
    expect(out.results[0].content).toBeUndefined();
  });
  test("content:true includes content", async () => {
    mock(searchRes);
    const out = JSON.parse((await call("search_documents", { q: "x", content: true })).result.content[0].text);
    expect(out.results[0].content).toBe("BIG");
  });
  test("missing arguments are treated as an empty search", async () => {
    mock(searchRes);
    expect((await call("search_documents")).result.isError).toBe(false);
    expect(sentBody().q).toBe("");
  });
  test("sends subscription key header", async () => {
    mock(searchRes);
    await call("search_documents", {});
    expect((calls[0]!.init.headers as any)["Ocp-Apim-Subscription-Key"]).toBeString();
  });
  test.each([
    ["bad date", { from: "2020/01/01" }],
    ["bad enum", { library: "nope" }],
    ["wrong type", { q: 5 }],
  ])("invalid args (%s) -> isError, upstream not called", async (_n, args) => {
    mock(searchRes);
    const r = await call("search_documents", args);
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toStartWith("Invalid arguments");
    expect(calls.length).toBe(0);
  });
  test("upstream error -> isError with status and body", async () => {
    mock("boom", 503);
    const r = await call("search_documents", { q: "x" });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toBe("ADAMS 503: boom");
  });
  test("unexpected upstream shape -> isError 502", async () => {
    mock({ nope: true });
    const r = await call("search_documents", { q: "x" });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toStartWith("ADAMS 502");
  });
});

describe("tools/call get_document", () => {
  test("returns the unwrapped document", async () => {
    mock({ document: doc });
    const r = await call("get_document", { accession: "ML1" });
    expect(r.result.isError).toBe(false);
    expect(JSON.parse(r.result.content[0].text)).toEqual(doc);
    expect(calls[0]!.url.endsWith("/api/search/ML1")).toBe(true);
  });
  test("accession is URL-encoded and cannot escape the path", async () => {
    mock({ document: doc });
    await call("get_document", { accession: "../../other" });
    expect(calls[0]!.url).not.toContain("/../");
    expect(calls[0]!.url).toContain("..%2F..%2Fother");
  });
  test("missing accession -> isError", async () => {
    mock({ document: doc });
    const r = await call("get_document", {});
    expect(r.result.isError).toBe(true);
    expect(calls.length).toBe(0);
  });
  test("upstream 404 -> isError", async () => {
    mock("not found", 404);
    const r = await call("get_document", { accession: "NOPE" });
    expect(r.result).toMatchObject({ isError: true, content: [{ text: "ADAMS 404: not found" }] });
  });
});

describe("tools/call errors", () => {
  test("unknown tool -> JSON-RPC -32602", async () => {
    const r = await call("nope");
    expect(r.error.code).toBe(-32602);
    expect(r.error.message).toContain("nope");
  });
  test("missing params -> -32602", async () => {
    const r: any = await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call" })).json();
    expect(r.error.code).toBe(-32602);
  });
});
