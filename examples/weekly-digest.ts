// Goal: "What did the NRC publish lately?" A Markdown digest you could paste into Slack or an email.
//
//   bun examples/weekly-digest.ts            # last 7 days
//   bun examples/weekly-digest.ts 30 > digest.md
//
// Uses the facet counts (over ALL matches, not just the first page) for the document-type mix.
import { api, day, must, run, topFacet } from "./client";

run(async () => {
  const days = Number(process.argv[2] ?? 7);
  const from = day(new Date(Date.now() - days * 86_400_000));

  const all = must(await api.search.get({ query: { from, sort: "DocumentDate", order: "desc" } }));
  const letters = must(await api.search.get({ query: { from, type: "Letter", sort: "DocumentDate", order: "desc" } }));

  console.log(`# NRC ADAMS digest: ${from} → ${day(new Date())}\n`);
  console.log(`**${all.count.toLocaleString()} documents** published in the last ${days} days.\n`);

  console.log("## What was published\n\n| Document type | Count |\n| --- | ---: |");
  for (const f of topFacet(all.facets, "DocumentType", 8)) console.log(`| ${f.value} | ${f.count.toLocaleString()} |`);

  console.log("\n## Most active authors\n");
  for (const f of topFacet(all.facets, "AuthorAffiliation", 5)) console.log(`- ${f.value} (${f.count.toLocaleString()})`);

  console.log(`\n## Latest letters (${letters.count.toLocaleString()} total)\n`);
  for (const d of letters.results.slice(0, 10)) {
    const route = [d.AuthorAffiliation?.[0], d.AddresseeAffiliation?.[0]].filter(Boolean).join(" → ");
    console.log(`- ${d.DocumentDate?.slice(0, 10)} [${d.DocumentTitle}](${d.Url})${route ? ` — ${route}` : ""}`);
  }
});
