import { describe, expect, test } from "bun:test";
import { app } from "./index";

// Hits the real ADAMS API with the key from .env. Skipped when no real key is configured.
const live = test.skipIf(!!process.env.ADAMS_FAKE_KEY);
const get = (p: string) => app.handle(new Request("http://localhost" + p));

describe("live ADAMS", () => {
  live("GET /search returns count, results and facets without content", async () => {
    const r = await get("/search?q=reactor");
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(typeof body.count).toBe("number");
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].AccessionNumber).toBeString();
    expect(body.results[0]).not.toHaveProperty("content");
  }, 30000);

  live("GET /documents/:id round-trips an accession number from search", async () => {
    const found: any = await (await get("/search?q=reactor")).json();
    const id = found.results[0].AccessionNumber;
    const r = await get(`/documents/${id}`);
    const doc: any = await r.json();
    expect(r.status).toBe(200);
    expect(doc.AccessionNumber).toBe(id);
  }, 30000);

  live("POST /search passthrough works", async () => {
    const r = await app.handle(new Request("http://localhost/search", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "steam generator", filters: [], anyFilters: [], mainLibFilter: false, legacyLibFilter: false, sort: "", sortDirection: 0 }),
    }));
    expect(r.status).toBe(200);
  }, 30000);

  live("docket filter only returns that docket", async () => {
    const j: any = await (await get("/search?q=reactor&docket=05000390")).json();
    expect(j.results.length).toBeGreaterThan(0);
    expect(j.results.every((r: any) => r.DocketNumber.includes("05000390"))).toBe(true);
  }, 30000);

  live("two dockets are ORed: count >= each alone", async () => {
    const n = async (qs: string) => ((await (await get(`/search?q=reactor&${qs}`)).json()) as any).count;
    const [a, b, both] = await Promise.all([n("docket=05000390"), n("docket=05000391"), n("docket=05000390&docket=05000391")]);
    expect(both).toBeGreaterThanOrEqual(Math.max(a, b));
    expect(both).toBeLessThanOrEqual(a + b);
  }, 30000);

  live("date range only returns documents in range", async () => {
    const j: any = await (await get("/search?q=reactor&from=2020-01-01&to=2020-12-31")).json();
    expect(j.results.length).toBeGreaterThan(0);
    expect(j.results.every((r: any) => r.DocumentDate >= "2020-01-01" && r.DocumentDate <= "2020-12-31")).toBe(true);
  }, 30000);

  live("library=main excludes legacy documents", async () => {
    const j: any = await (await get("/search?q=reactor&library=main")).json();
    expect(j.results.every((r: any) => String(r.IsLegacy).toLowerCase() !== "true")).toBe(true);
  }, 30000);
});

describe("live ADAMS: filter-only searches (no q)", () => {
  live("docket alone (no q) returns results — q=\"*\" would return 0", async () => {
    const j: any = await (await get("/search?docket=05000390")).json();
    expect(j.count).toBeGreaterThan(0);
    expect(j.results.every((r: any) => r.DocketNumber.includes("05000390"))).toBe(true);
  }, 30000);

  live("date range alone (no q) returns results", async () => {
    const j: any = await (await get("/search?from=2020-01-01&to=2020-01-31")).json();
    expect(j.count).toBeGreaterThan(0);
  }, 30000);
});
