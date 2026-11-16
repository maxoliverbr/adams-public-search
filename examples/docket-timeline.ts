// Goal: "How has regulatory activity around a plant changed over the decades?"
// Plots documents per year for one or more dockets as an ASCII chart. Pass several dockets to compare sites.
//
//   bun examples/docket-timeline.ts                       # Watts Bar 1 vs 2 (default)
//   bun examples/docket-timeline.ts 05000390 05000391 05000327
//
// Note: only documents with a DocumentDate are counted (many legacy records have none).
import { api, bar, must, pmap, run } from "./client";

run(async () => {
  const dockets = process.argv.slice(2).length ? process.argv.slice(2) : ["05000390", "05000391"];
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 1989 }, (_, i) => 1990 + i);

  const jobs = dockets.flatMap((docket) => years.map((year) => ({ docket, year })));
  const counts = await pmap(jobs, 6, async ({ docket, year }) => {
    const r = must(await api.search.get({ query: { docket, from: `${year}-01-01`, to: `${year}-12-31` } }));
    return { docket, year, n: r.count };
  });

  const max = Math.max(1, ...counts.map((c) => c.n));
  console.log(`Documents per year (scale: ${bar(max, max, 20)} = ${max})\n`);
  for (const year of years) {
    console.log(String(year));
    for (const docket of dockets) {
      const n = counts.find((c) => c.docket === docket && c.year === year)?.n ?? 0;
      console.log(`  ${docket} ${bar(n, max)} ${n}`);
    }
  }
  for (const docket of dockets) {
    const rows = counts.filter((c) => c.docket === docket);
    const peak = rows.reduce((a, b) => (b.n > a.n ? b : a));
    console.log(`\n${docket}: ${rows.reduce((s, c) => s + c.n, 0)} documents since 1990, busiest year ${peak.year} (${peak.n})`);
  }
});
