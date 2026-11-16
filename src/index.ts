import { Elysia, t } from "elysia";
import { openapi } from "@elysiajs/openapi";

const BASE = "https://adams-api.nrc.gov/aps/api/search";

const many = t.Optional(t.Union([t.String(), t.Array(t.String())]));
const list = (v?: string | string[]) => (v === undefined ? [] : [v].flat());
const q = (s: string) => s.replaceAll("'", "''"); // OData string escape

// Real filter shape (not the string[] the published spec claims): {field, value, operator}.
// Verified live: `filters` are ANDed, `anyFilters` are ORed, and the two groups are ANDed together.
type Op = "equals" | "contains";
const clause = (field: string, vals: string[], operator: Op) => vals.map((value) => ({ field, value, operator }));
const date = /^\d{4}-\d{2}-\d{2}$/;

const SearchQuery = t.Object({
  q: t.Optional(t.String()),
  docket: many,
  type: many,
  author: many,
  addressee: many,
  keyword: many,
  from: t.Optional(t.String({ pattern: date.source })), // YYYY-MM-DD
  to: t.Optional(t.String({ pattern: date.source })),
  library: t.Optional(t.Union([t.Literal("main"), t.Literal("legacy"), t.Literal("all")])),
  sort: t.Optional(t.String()),
  order: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
  content: t.Optional(t.Boolean()),
});
type SearchQuery = typeof SearchQuery.static;

export function buildSearchBody(p: SearchQuery) {
  const filters: object[] = [];
  const anyFilters: object[] = [];
  // One value -> required (filters). Several values -> any-of (anyFilters).
  // ponytail: anyFilters is a single OR group, so two multi-valued params OR together across fields.
  for (const [field, vals, op] of [
    ["DocketNumber", list(p.docket), "equals"],
    ["DocumentType", list(p.type), "equals"],
    ["AuthorName", list(p.author), "contains"],
    ["AddresseeName", list(p.addressee), "contains"],
    ["Keyword", list(p.keyword), "contains"],
  ] as [string, string[], Op][])
    (vals.length > 1 ? anyFilters : filters).push(...clause(field, vals, op));

  if (p.from || p.to) {
    const parts = [p.from && `DocumentDate ge '${q(p.from)}'`, p.to && `DocumentDate le '${q(p.to)}'`];
    filters.push({ field: "DocumentDate", value: `(${parts.filter(Boolean).join(" and ")})` });
  }
  return {
    q: p.q ?? "*",
    filters,
    anyFilters,
    mainLibFilter: p.library !== "legacy",
    legacyLibFilter: p.library !== "main",
    sort: p.sort ?? "",
    sortDirection: p.order === "desc" ? 1 : 0,
  };
}

const key = process.env.ADAMS_API_KEY ?? process.env.ADAMSNRC_API_KEY;

async function upstream(path: string, init: RequestInit = {}) {
  if (!key) return Response.json({ error: "ADAMS_API_KEY not set" }, { status: 500 });
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": key },
  });
  return res;
}

// Pass upstream errors through as-is; return parsed JSON on success.
async function unwrap(res: Response, set: { status?: number | string }) {
  if (!res.ok) {
    set.status = res.status;
    return res.text();
  }
  return res.json();
}

export const app = new Elysia()
  .use(openapi({ documentation: { info: { title: "ADAMS Public Search Wrapper", version: "1.0.0" } } }))
  .get("/documents/:accession", async ({ params, set }) => {
    const data = await unwrap(await upstream(`/${encodeURIComponent(params.accession)}`), set);
    return data?.document ?? data;
  })
  .get(
    "/search",
    async ({ query, set }) => {
      const data = await unwrap(
        await upstream("", { method: "POST", body: JSON.stringify(buildSearchBody(query)) }),
        set,
      );
      if (!data?.results) return data;
      return {
        count: data.count,
        results: data.results.map(({ score, document: { content, ...doc } }: any) => ({
          score,
          ...doc,
          ...(query.content ? { content } : {}),
        })),
        facets: data.facets,
      };
    },
    { query: SearchQuery },
  )
  .post("/search", async ({ body, set }) =>
    unwrap(await upstream("", { method: "POST", body: JSON.stringify(body) }), set),
    { body: t.Record(t.String(), t.Any()) },
  );

if (import.meta.main) {
  if (!key) throw new Error("ADAMS_API_KEY (or ADAMSNRC_API_KEY) not set (see .env.example)");
  app.listen(Number(process.env.PORT ?? 3000));
  console.log(`ADAMS wrapper on :${process.env.PORT ?? 3000}`);
}
