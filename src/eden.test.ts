import { afterEach, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { app, type AdamsDocument, type App, type SearchResponse } from "./index";

// In-process typed client: no network to our app, `fetch` to ADAMS is mocked.
// `bun run typecheck` fails if any call below stops matching the server's types.
const api = treaty<App>(app);

const doc = { AccessionNumber: "ML1", DocumentTitle: "T", DocketNumber: ["05000390"], DistributionListCodes: "ABC", content: "BIG", PackageNumber: null };
const searchRes = { count: 1, results: [{ score: 0.5, semanticSearch: {}, document: doc }], facets: { Keyword: ["k"] } };

const realFetch = globalThis.fetch;
function mock(body: unknown, status = 200) {
  globalThis.fetch = (async () => Response.json(body, { status })) as unknown as typeof fetch;
}
afterEach(() => (globalThis.fetch = realFetch));

test("api.documents({accession}).get() is typed as AdamsDocument", async () => {
  mock({ document: doc });
  const { data, error } = await api.documents({ accession: "ML1" }).get();
  expect(error).toBeNull();
  const d: AdamsDocument | null = data; // compile-time: data is AdamsDocument | null
  expect(d?.AccessionNumber).toBe("ML1");
  expect(d?.DocketNumber?.[0]).toBe("05000390"); // string[] | null | undefined
});

test("api.search.get({query}) is typed end to end", async () => {
  mock(searchRes);
  const { data } = await api.search.get({ query: { q: "reactor", docket: ["a", "b"], library: "main", order: "desc", content: true } });
  const r: SearchResponse | null = data;
  expect(r?.count).toBe(1);
  expect(r?.results[0]?.score).toBe(0.5);
  expect(r?.results[0]?.content).toBe("BIG");
  expect(r?.results[0]?.DocumentTitle).toBe("T");
});

test("api.search.post(body) is typed with the real filter shape", async () => {
  mock(searchRes);
  const { data } = await api.search.post({
    q: "x",
    filters: [{ field: "DocketNumber", value: "05000390", operator: "equals" }],
  });
  expect(data?.count).toBe(1);
  expect(data?.results[0]?.document.AccessionNumber).toBe("ML1");
});

test("invalid calls are compile errors (checked by tsc) and 422s at runtime", async () => {
  // @ts-expect-error library must be "main" | "legacy" | "all"
  const a = await api.search.get({ query: { library: "nope" } });
  expect(a.status).toBe(422);
  // @ts-expect-error order must be "asc" | "desc"
  const b = await api.search.get({ query: { order: "sideways" } });
  expect(b.status).toBe(422);
  // @ts-expect-error filters must be {field,value,operator} objects, not strings
  const c = await api.search.post({ q: "x", filters: ["DocketNumber eq '1'"] });
  expect(c.status).toBe(422);
});

test("upstream errors surface as typed `error` with the original status", async () => {
  mock({ statusCode: 401, message: "denied" }, 401);
  const { data, error } = await api.search.get({ query: { q: "x" } });
  expect(data).toBeNull();
  expect(error?.status).toBe(401);
});
