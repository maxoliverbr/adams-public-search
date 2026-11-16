<p align="center">
  <img src="assets/logo.svg" alt="ADAMS Search Wrapper logo" width="120">
</p>

<h1 align="center">ADAMS Search Wrapper</h1>

<p align="center">
  A small <a href="https://bun.sh">Bun</a> + <a href="https://elysiajs.com">Elysia</a> API that makes searching the
  <a href="https://adams-search.nrc.gov">NRC ADAMS Public Search</a> service simple.<br>
  Plain query parameters in, clean JSON out.
</p>

<p align="center">
  <a href="https://maxoliverbr.github.io/adams-public-search/">Landing page</a> ·
  <a href="https://adams-api-developer.nrc.gov/api-details#api=adams-public-search-api&operation=get-document">Upstream API docs</a> ·
  <a href="https://adams-api-developer.nrc.gov">Get an ADAMS API key</a>
</p>

---

## Why

The upstream search endpoint (`POST /aps/api/search`) takes a JSON body whose `filters` must be objects like
`{"field","value","operator"}`, even though the published OpenAPI spec says they are strings (strings get a `500`).
This wrapper hides that behind a `GET /search` you can call from a browser or `curl`, strips the very large `content`
field by default, and keeps your ADAMS subscription key on the server.

## Features

- `GET /documents/:accession`: one document by ML number, unwrapped
- `GET /search`: simplified search with typed, validated query parameters
- `POST /search`: raw passthrough of the upstream request body, for anything the simple params can't express
- End-to-end type safety: typed requests and responses, plus an [Eden Treaty](https://elysiajs.com/eden/overview) client (see below)
- Interactive OpenAPI docs at `/openapi` (JSON at `/openapi/json`), including response shapes
- Upstream errors (401, 404, ...) are passed through with their original status
- Mocked tests plus live tests against the real ADAMS API

## Quick start

You need [Bun](https://bun.sh) and an ADAMS API subscription key from the
[developer portal](https://adams-api-developer.nrc.gov).

```sh
git clone https://github.com/maxoliverbr/adams-public-search
cd adams-public-search
bun install
cp .env.example .env     # then set ADAMS_API_KEY
bun run dev              # http://localhost:3000
```

| Variable | Required | Description |
| --- | --- | --- |
| `ADAMS_API_KEY` | yes | ADAMS subscription key (`ADAMSNRC_API_KEY` is also accepted) |
| `PORT` | no | Port to listen on, default `3000` |

## Examples

```sh
# One document by accession number
curl localhost:3000/documents/ML20055E745

# Docket + date range, newest first
curl 'localhost:3000/search?q=reactor&docket=05000390&from=2020-01-01&to=2020-12-31&sort=DocumentDate&order=desc'

# Two dockets (OR), main library only
curl 'localhost:3000/search?q=steam+generator&docket=05000390&docket=05000391&library=main'

# Include the full document text in each result
curl 'localhost:3000/search?q=reactor&content=true'

# Raw upstream body
curl -X POST localhost:3000/search -H 'content-type: application/json' \
  -d '{"q":"steam generator","filters":[],"anyFilters":[],"mainLibFilter":true,"legacyLibFilter":true,"sort":"","sortDirection":1}'
```

`GET /search` returns (abbreviated):

```jsonc
{
  "count": 17682,
  "results": [
    { "score": 99.39, "AccessionNumber": "ML...", "DocumentTitle": "...", "DocketNumber": ["05000390"], "DocumentDate": "2017-11-06" }
  ],
  "facets": { "DocumentType": [{ "value": "Letter", "count": 123 }] }
}
```

## Typed client (Eden)

The app exports its type, so any TypeScript client gets autocomplete and compile-time checks with
[Eden Treaty](https://elysiajs.com/eden/overview):

```ts
import { treaty } from "@elysiajs/eden";
import type { App } from "adams-public-search/src/index"; // or a relative path

// parseDate:false keeps ISO date strings as strings, matching the types
// (Eden otherwise converts them to Date objects at runtime).
const api = treaty<App>("localhost:3000", { parseDate: false });

const { data, error } = await api.search.get({
  query: { q: "reactor", docket: "05000390", from: "2020-01-01", order: "desc" },
});
if (error) throw new Error(`ADAMS error ${error.status}`);
data.results[0]?.DocumentTitle; // typed: string | null | undefined

const doc = await api.documents({ accession: "ML20055E745" }).get();
```

How the types stay honest:

- Request params are validated at runtime and typed from the same schema (bad dates or enums return `422`).
- Every response from ADAMS is **validated against a schema before it is returned**. If ADAMS changes shape, you get a
  `502 Unexpected ADAMS response shape` (with the offending path) instead of silently wrong data.
- The schemas are the published spec **corrected against live data** (nullable fields, `DistributionListCodes` is a string,
  extra fields like `PackageNumber`). Unknown extra fields are allowed.
- Upstream error statuses (400, 401, 403, 404, 429, 500, 502) are typed on `error.status`; their bodies are passed through as-is.

## Examples

Runnable scripts in [`examples/`](examples), all using the typed Eden client. Start the API (`bun run dev`), then:

| Script | Goal |
| --- | --- |
| `bun examples/weekly-digest.ts [days]` | A Markdown digest of what the NRC published lately: type mix, most active authors, latest letters. Pipe it to a file or Slack. |
| `bun examples/docket-timeline.ts [docket…]` | How regulatory activity around a plant changed over the decades, as an ASCII chart. Pass several dockets to compare sites. |
| `bun examples/topic-radar.ts "<topic>" [from]` | Who is involved in a topic: document mix, most active organisations, dockets, and who writes to whom. |
| `bun examples/package-dossier.ts [ML…]` | What is inside an ADAMS package: fetches the package and all its documents concurrently and prints a tree. |

For example, `bun examples/topic-radar.ts "small modular reactor" 2024-01-01` reports 2,114 matching documents and shows
that `NRC/NRR` is both the most active author and, by far, the most addressed recipient.

Set `ADAMS_URL` if the API isn't on `localhost:3000`. Shared helpers (`must`, `topFacet`, `pmap`) are in
[`examples/client.ts`](examples/client.ts). The examples are type-checked by `bun run typecheck` and CI.

## Search parameters

| Param | Meaning |
| --- | --- |
| `q` | Search text. Optional: omit it to search by filters only |
| `docket`, `type` | Exact match. Repeat the param for any-of |
| `author`, `addressee`, `keyword` | Contains match. Repeat the param for any-of |
| `from`, `to` | Document date range, `YYYY-MM-DD` |
| `library` | `main`, `legacy` or `all` (default) |
| `sort`, `order` | Field name and `asc` / `desc` |
| `content` | `true` to include each document's full text |

A single value is a required filter (ANDed with the others). Repeated values are an any-of group (ORed).

> **Limitation:** all any-of values share one OR group, so if you repeat two *different* params
> (say two dockets and two document types), those conditions are ORed together across fields.

## Development

```sh
bun test            # mocked tests always run; live tests run when a real key is in .env
bun run typecheck   # strict tsc over src/ and tests (includes the Eden type-level checks)
bun run dev         # watch mode
```

- `src/index.ts`: the app and `buildSearchBody`, which maps query params to the upstream body
- `src/eden.test.ts`: typed Eden client tests; `@ts-expect-error` lines prove invalid calls fail to compile
- `src/api.test.ts`: spec-driven tests with a mocked `fetch`, using `docs/adams-public-search-api.yaml`
- `src/live.test.ts`: tests against the real ADAMS API (skipped without a real key)
- `site/`: the landing page, deployed to GitHub Pages by `.github/workflows/pages.yml`

## Security

The wrapper adds your subscription key to every upstream request and does **not** authenticate its own callers.
Anyone who can reach it uses your ADAMS quota, so keep it on localhost or behind your own auth/proxy.

## License

[MIT](LICENSE) © 2026 Max Oliver

## Disclaimer

Not affiliated with the U.S. Nuclear Regulatory Commission. Data comes from the public ADAMS service.
