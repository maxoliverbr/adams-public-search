import { Elysia, t, type Static } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

const BASE = "https://adams-api.nrc.gov/aps/api/search";

// ---------- Schemas: the single source of truth for runtime validation AND static types ----------

// Shapes below come from the published spec corrected against a live survey of 500 documents:
// fields are often null, DistributionListCodes is a string (spec says array), and ADAMS returns extra
// fields the spec omits (PackageNumber, DocumentSize, MicroformAddresses). Unknown extras are allowed.
const str = t.Optional(t.Nullable(t.String()));
const strs = t.Optional(t.Nullable(t.Array(t.String())));

export const AdamsDocument = t.Object({
  IdT: str, Id: str, Name: str, AccessionNumber: str, AccessionNumberLower: str, Availability: str,
  AuthorName: strs, AuthorAffiliation: strs, AddresseeName: strs, AddresseeAffiliation: strs,
  CaseReferenceNumber: strs, Comment: str, ContactPerson: str,
  DocumentTitle: str, DocumentTitleEquals: str, DocumentTitleWord: str,
  DateAdded: str, DateAddedTimestamp: str, DocumentDate: str,
  DocumentType: strs, DocumentReportNumber: strs, DocketNumber: strs,
  DistributionListCodes: t.Optional(t.Nullable(t.Union([t.String(), t.Array(t.String())]))),
  DocumentsFiledInPackage: strs, LicenseNumber: strs, PackageNumber: str, DocumentSize: str, MicroformAddresses: str,
  Keyword: strs, PackagesFiledIn: strs,
  Url: str, content: str, IsPackage: str, IsLegacy: str, ItemType: str,
  PhysicalFileLocation: str, EstimatedPageCount: str,
}, { additionalProperties: true });
export type AdamsDocument = Static<typeof AdamsDocument>;

// Real filter shape (not the string[] the published spec claims): {field, value, operator}.
// Verified live: `filters` are ANDed, `anyFilters` are ORed, and the two groups are ANDed together.
export const Filter = t.Object({
  field: t.String(),
  value: t.String(),
  operator: t.Optional(
    t.Union([
      t.Literal("contains"), t.Literal("notcontains"), t.Literal("equals"),
      t.Literal("notequals"), t.Literal("starts"), t.Literal("notstarts"),
    ]),
  ),
});
export type Filter = Static<typeof Filter>;

export const UpstreamSearchBody = t.Object({
  q: t.String(),
  filters: t.Optional(t.Array(Filter)),
  anyFilters: t.Optional(t.Array(Filter)),
  mainLibFilter: t.Optional(t.Boolean()),
  legacyLibFilter: t.Optional(t.Boolean()),
  sort: t.Optional(t.String()),
  sortDirection: t.Optional(t.Integer()),
});
export type UpstreamSearchBody = Static<typeof UpstreamSearchBody>;

const Facets = t.Optional(
  t.Nullable(
    t.Record(
      t.String(),
      t.Array(t.Union([t.String(), t.Object({ value: t.Nullable(t.String()), count: t.Number() })])),
    ),
  ),
);

const UpstreamSearchResponse = t.Object(
  {
    count: t.Number(),
    results: t.Array(t.Object({ score: t.Number(), document: AdamsDocument }, { additionalProperties: true })),
    facets: Facets,
  },
  { additionalProperties: true },
);
const UpstreamDocumentResponse = t.Object({ document: AdamsDocument }, { additionalProperties: true });

export const SearchResponse = t.Object({
  count: t.Number(),
  results: t.Array(t.Composite([t.Object({ score: t.Number() }), AdamsDocument])),
  facets: Facets,
});
export type SearchResponse = Static<typeof SearchResponse>;

// Upstream errors are passed through verbatim (JSON or text), so the body is intentionally untyped.
// Declared per status so Eden clients get a typed `error.status`. Other upstream statuses still pass through.
const UpstreamErrorBody = t.Unknown();
const errorResponses = {
  400: UpstreamErrorBody, 401: UpstreamErrorBody, 403: UpstreamErrorBody, 404: UpstreamErrorBody,
  429: UpstreamErrorBody, 500: UpstreamErrorBody, 502: UpstreamErrorBody,
};

const many = t.Optional(t.Union([t.String(), t.Array(t.String())]));
const date = /^\d{4}-\d{2}-\d{2}$/;

export const SearchQuery = t.Object({
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
export type SearchQuery = Static<typeof SearchQuery>;

// ---------- Query -> upstream body ----------

const list = (v?: string | string[]) => (v === undefined ? [] : [v].flat());
const q = (s: string) => s.replaceAll("'", "''"); // OData string escape
type Op = NonNullable<Filter["operator"]>;
const clause = (field: string, vals: string[], operator: Op): Filter[] => vals.map((value) => ({ field, value, operator }));

export function buildSearchBody(p: SearchQuery): Required<UpstreamSearchBody> {
  const filters: Filter[] = [];
  const anyFilters: Filter[] = [];
  // One value -> required (filters). Several values -> any-of (anyFilters).
  // ponytail: anyFilters is a single OR group, so two multi-valued params OR together across fields.
  const fields: [string, string[], Op][] = [
    ["DocketNumber", list(p.docket), "equals"],
    ["DocumentType", list(p.type), "equals"],
    ["AuthorName", list(p.author), "contains"],
    ["AddresseeName", list(p.addressee), "contains"],
    ["Keyword", list(p.keyword), "contains"],
  ];
  for (const [field, vals, op] of fields) (vals.length > 1 ? anyFilters : filters).push(...clause(field, vals, op));

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

// ---------- Upstream client ----------

const key = process.env.ADAMS_API_KEY ?? process.env.ADAMSNRC_API_KEY;

/** Upstream failure, passed through to the caller with its original status and body. */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly contentType = "text/plain",
  ) {
    super(`ADAMS upstream ${status}`);
  }
}

/** Calls ADAMS and returns the body only if it matches `schema`, so the static type is honest. */
async function upstream<S extends TSchema>(path: string, schema: S, init: RequestInit = {}): Promise<Static<S>> {
  if (!key) throw new UpstreamError(500, JSON.stringify({ error: "ADAMS_API_KEY not set" }), "application/json");
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": key },
  });
  if (!res.ok) throw new UpstreamError(res.status, await res.text(), res.headers.get("content-type") ?? undefined);
  const data: unknown = await res.json();
  if (!Value.Check(schema, data)) {
    const first = [...Value.Errors(schema, data)][0];
    throw new UpstreamError(
      502,
      JSON.stringify({ error: "Unexpected ADAMS response shape", path: first?.path, message: first?.message }),
      "application/json",
    );
  }
  return data;
}

const post = (body: UpstreamSearchBody) => ({ method: "POST", body: JSON.stringify(body) });

// ---------- App ----------

export const app = new Elysia()
  .use(openapi({ documentation: { info: { title: "ADAMS Public Search Wrapper", version: "1.0.0" } } }))
  .error({ UPSTREAM: UpstreamError })
  .onError(({ code, error }) => {
    if (code === "UPSTREAM")
      return new Response(error.body, { status: error.status, headers: { "content-type": error.contentType } });
  })
  .get(
    "/documents/:accession",
    async ({ params }) => (await upstream(`/${encodeURIComponent(params.accession)}`, UpstreamDocumentResponse)).document,
    { response: { 200: AdamsDocument, ...errorResponses } },
  )
  .get(
    "/search",
    async ({ query }): Promise<SearchResponse> => {
      const data = await upstream("", UpstreamSearchResponse, post(buildSearchBody(query)));
      return {
        count: data.count,
        results: data.results.map(({ score, document: { content, ...doc } }) => ({
          score,
          ...doc,
          ...(query.content ? { content } : {}),
        })),
        facets: data.facets,
      };
    },
    { query: SearchQuery, response: { 200: SearchResponse, ...errorResponses } },
  )
  .post("/search", ({ body }) => upstream("", UpstreamSearchResponse, post(body)), {
    body: UpstreamSearchBody,
    response: { 200: UpstreamSearchResponse, ...errorResponses },
  });

export type App = typeof app;

if (import.meta.main) {
  if (!key) throw new Error("ADAMS_API_KEY (or ADAMSNRC_API_KEY) not set (see .env.example)");
  app.listen(Number(process.env.PORT ?? 3000));
  console.log(`ADAMS wrapper on :${process.env.PORT ?? 3000}`);
}
