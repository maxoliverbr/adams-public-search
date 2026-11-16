// Shared helpers for the examples. Start the API first:  bun run dev
import { treaty } from "@elysiajs/eden";
import type { App } from "../src/index";

// parseDate:false keeps ISO date strings as strings, matching the static types (Eden would make Date objects).
export const api = treaty<App>(process.env.ADAMS_URL ?? "localhost:3000", { parseDate: false });

/** Unwrap an Eden response: return `data`, or throw with the upstream status. */
export function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error !== null || res.data === null) {
    const e = res.error as { status?: unknown; value?: unknown } | null;
    throw new Error(`API error ${e?.status ?? "?"}: ${JSON.stringify(e?.value ?? "no data")}`);
  }
  return res.data;
}

/** Top `n` entries of a facet as {value, count}. Facets are `(string | {value,count})[]`; strings carry no count. */
export function topFacet(facets: Record<string, unknown[]> | null | undefined, name: string, n = 5) {
  return (facets?.[name] ?? [])
    .filter((f): f is { value: string; count: number } => typeof f === "object" && f !== null && "count" in f)
    .slice(0, n);
}

/** Map with bounded concurrency, so we stay polite to ADAMS. */
export async function pmap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

export const bar = (n: number, max: number, width = 40) => "█".repeat(max ? Math.round((n / max) * width) : 0);
export const day = (d: Date) => d.toISOString().slice(0, 10);

/** Run an example's main(), with a friendly message if the API isn't up. */
export function run(main: () => Promise<void>) {
  main().catch((e: Error) => {
    const down = /ConnectionRefused|ECONNREFUSED|Unable to connect|fetch failed/i.test(`${e.message} ${e.cause ?? ""}`);
    console.error(down ? "Can't reach the API. Start it first with:  bun run dev" : e.message);
    process.exit(1);
  });
}
