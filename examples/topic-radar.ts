// Goal: "Who is involved in this topic, and who is talking to whom?"
// Searches a topic and summarises the document mix, the most active organisations and dockets
// (facets cover every match), plus the most common sender → recipient pairs on the newest page of hits.
//
//   bun examples/topic-radar.ts "small modular reactor"
//   bun examples/topic-radar.ts "steam generator tube" 2023-01-01   # optional start date
import { api, bar, must, run, topFacet } from "./client";

run(async () => {
  const [topic, from] = [process.argv[2], process.argv[3]];
  if (!topic) throw new Error('Usage: bun examples/topic-radar.ts "<topic>" [from YYYY-MM-DD]');

  const r = must(await api.search.get({ query: { q: topic, from, sort: "DocumentDate", order: "desc" } }));
  console.log(`"${topic}"${from ? ` since ${from}` : ""}: ${r.count.toLocaleString()} documents\n`);

  for (const [title, facet] of [
    ["Document types", "DocumentType"],
    ["Most active authors", "AuthorAffiliation"],
    ["Most addressed recipients", "AddresseeAffiliation"],
    ["Dockets", "DocketNumber"],
  ] as const) {
    const rows = topFacet(r.facets, facet, 6);
    if (!rows.length) continue;
    const max = rows[0]?.count ?? 1;
    console.log(title);
    for (const f of rows) console.log(`  ${f.value.slice(0, 38).padEnd(38)} ${bar(f.count, max, 24)} ${f.count.toLocaleString()}`);
    console.log();
  }

  const pairs = new Map<string, number>();
  for (const d of r.results) {
    const from = d.AuthorAffiliation?.[0];
    const to = d.AddresseeAffiliation?.[0];
    if (from && to) pairs.set(`${from} → ${to}`, (pairs.get(`${from} → ${to}`) ?? 0) + 1);
  }
  console.log(`Who writes to whom (newest ${r.results.length} hits)`);
  for (const [pair, n] of [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${String(n).padStart(2)}×  ${pair}`);
});
