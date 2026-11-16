import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { app } from "./index";

const spec: any = Bun.YAML.parse(readFileSync("docs/adams-public-search-api.yaml", "utf8"));
const schemas = spec.components.schemas;
const keyHeader = spec.components.securitySchemes.apiKeyHeader.name;
const queryProps = Object.keys(schemas.Search_Query.properties);

// Fixtures shaped by the spec's Search_Results / APS_Search_Document schemas.
const doc = { AccessionNumber: "ML1", DocumentTitle: "T", DocketNumber: ["05000390"], content: "BIG" };
const searchRes = { count: 1, results: [{ score: 0.5, semanticSearch: {}, document: doc }], facets: { Keyword: [] } };

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

const get = (p: string) => app.handle(new Request("http://localhost" + p));
const post = (p: string, body: unknown) =>
  app.handle(new Request("http://localhost" + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const sent = () => JSON.parse(calls[0]!.init.body as string);

describe("upstream contract (from spec)", () => {
  test("GET /documents/:id hits servers.url + path template with subscription key", async () => {
    mock({ document: doc });
    await get("/documents/ML1");
    expect(calls[0]!.url).toBe(spec.servers[0].url + "/api/search/ML1");
    expect((calls[0]!.init.headers as any)[keyHeader]).toBe(process.env.ADAMS_API_KEY ?? process.env.ADAMSNRC_API_KEY);
    expect(spec.paths["/api/search/{accessionNumber}"].get).toBeDefined();
  });

  test("search POSTs to /api/search with a body matching Search_Query types", async () => {
    mock(searchRes);
    await get("/search?q=reactor&docket=a&library=legacy&order=desc&sort=DocumentDate");
    expect(calls[0]!.url).toBe(spec.servers[0].url + "/api/search");
    expect(calls[0]!.init.method).toBe("POST");
    const b = sent();
    const p = schemas.Search_Query.properties;
    expect(Object.keys(b).every((k) => queryProps.includes(k))).toBe(true);
    expect(typeof b.q).toBe("string");
    // spec says string[]; the live API actually requires {field,value,operator} objects (see live.test.ts)
    expect(Array.isArray(b.filters)).toBe(true);
    expect(Array.isArray(b.anyFilters)).toBe(true);
    expect(typeof b.legacyLibFilter).toBe("boolean");
    expect(typeof b.mainLibFilter).toBe("boolean");
    expect(Number.isInteger(b.sortDirection)).toBe(true);
    expect(p.sortDirection.type).toBe("integer");
  });
});

describe("GET /documents/:id", () => {
  test("unwraps { document }", async () => {
    mock({ document: doc });
    expect(await (await get("/documents/ML1")).json()).toEqual(doc);
  });
  test("passes upstream error status through", async () => {
    mock("not found", 404);
    const r = await get("/documents/NOPE");
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("not found");
  });
  test("accession is encoded once and cannot escape the path", async () => {
    mock({ document: doc });
    await get("/documents/a%20b");
    expect(calls[0]!.url.endsWith("/api/search/a%20b")).toBe(true);
    await get("/documents/..%2F..%2Fother");
    expect(calls[1]!.url.startsWith(spec.servers[0].url + "/api/search/")).toBe(true);
    expect(calls[1]!.url).not.toContain("/../");
  });
});

describe("GET /search", () => {
  test("flattens results, strips content by default, keeps score + facets + count", async () => {
    mock(searchRes);
    const j: any = await (await get("/search?q=x")).json();
    expect(j.count).toBe(1);
    expect(j.facets).toEqual(searchRes.facets);
    expect(j.results[0]).toEqual({ score: 0.5, AccessionNumber: "ML1", DocumentTitle: "T", DocketNumber: ["05000390"] });
  });
  test("content=true keeps content", async () => {
    mock(searchRes);
    const j: any = await (await get("/search?content=true")).json();
    expect(j.results[0].content).toBe("BIG");
  });
  test("defaults: empty q, no filters, both libraries, asc", async () => {
    mock(searchRes);
    await get("/search");
    expect(sent()).toEqual({ q: "", filters: [], anyFilters: [], mainLibFilter: true, legacyLibFilter: true, sort: "", sortDirection: 0 });
  });
  test("repeated params and date range become filters", async () => {
    mock(searchRes);
    await get("/search?docket=a&docket=b&from=2020-01-01&to=2021-01-01&library=main");
    const b = sent();
    expect(b.anyFilters).toHaveLength(2);
    expect(b.filters).toHaveLength(1); // the date range
    expect(b.mainLibFilter).toBe(true);
    expect(b.legacyLibFilter).toBe(false);
  });
  test("rejects invalid enum values with 422", async () => {
    mock(searchRes);
    expect((await get("/search?library=nope")).status).toBe(422);
    expect((await get("/search?order=sideways")).status).toBe(422);
    expect((await get("/search?from=yesterday")).status).toBe(422);
    expect(calls).toHaveLength(0);
  });
  test("passes upstream errors through", async () => {
    mock({ statusCode: 401, message: "denied" }, 401);
    expect((await get("/search?q=x")).status).toBe(401);
  });
});

describe("POST /search", () => {
  test("rejects the spec's string[] filters (upstream 500s on them) with 422", async () => {
    mock(searchRes);
    expect((await post("/search", { q: "x", filters: ["DocketNumber eq '1'"] })).status).toBe(422);
    expect(calls).toHaveLength(0);
  });
  test("502 when upstream returns an unexpected shape", async () => {
    mock({ count: "many", results: [] });
    const r = await post("/search", { q: "x" });
    expect(r.status).toBe(502);
    expect(((await r.json()) as any).error).toContain("Unexpected ADAMS response shape");
  });
  test("forwards body verbatim and returns upstream JSON untouched", async () => {
    mock(searchRes);
    const body = { q: "steam", filters: [{ field: "DocketNumber", value: "1", operator: "equals" }], anyFilters: [], sort: "", sortDirection: 1 };
    const r = await post("/search", body);
    expect(sent()).toEqual(body);
    expect(await r.json()).toEqual(searchRes);
  });
});

describe("OpenAPI", () => {
  test("serves a spec listing all routes, and the UI", async () => {
    const j: any = await (await get("/openapi/json")).json();
    expect(j.openapi).toMatch(/^3\./);
    expect(Object.keys(j.paths)).toEqual(expect.arrayContaining(["/search", "/documents/{accession}"]));
    expect(Object.keys(j.paths["/search"])).toEqual(expect.arrayContaining(["get", "post"]));
    expect((await get("/openapi")).status).toBe(200);
  });
});
