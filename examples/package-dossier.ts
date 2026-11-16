// Goal: "What is actually inside this ADAMS package?"
// ADAMS packages bundle many documents. This fetches a package and all its children concurrently
// and prints them as a tree. With no argument it finds a sample package for you.
//
//   bun examples/package-dossier.ts ML0037040030
//   bun examples/package-dossier.ts
import { api, must, pmap, run } from "./client";

run(async () => {
  let accession = process.argv[2];
  if (!accession) {
    const hits = must(await api.search.get({ query: { q: "steam generator tube inspection summary reports" } }));
    accession = hits.results.find((d) => d.IsPackage === "Yes")?.AccessionNumber ?? undefined;
    if (!accession) throw new Error("No sample package found; pass an accession number.");
    console.log(`(no argument given, using sample package ${accession})\n`);
  }

  const pkg = must(await api.documents({ accession }).get());
  const kids = pkg.DocumentsFiledInPackage ?? [];
  console.log(`${pkg.AccessionNumber}  ${pkg.DocumentTitle}`);
  console.log(`  ${pkg.DocumentDate?.slice(0, 10) ?? pkg.DateAdded?.slice(0, 10) ?? "undated"} · ${kids.length} documents filed in this package\n`);

  const docs = await pmap(kids, 5, async (id) => {
    try {
      return { id, doc: must(await api.documents({ accession: id }).get()) };
    } catch {
      return { id, doc: null };
    }
  });

  docs.forEach(({ id, doc }, i) => {
    const branch = i === docs.length - 1 ? "└─" : "├─";
    console.log(`${branch} ${id}  ${doc ? (doc.DocumentTitle ?? "(untitled)").slice(0, 70) : "(could not be fetched)"}`);
    if (doc) console.log(`${i === docs.length - 1 ? "   " : "│  "}   ${doc.DocumentType?.[0] ?? "type n/a"} · ${doc.EstimatedPageCount ?? "?"} pages · ${doc.Url ?? ""}`);
  });
});
