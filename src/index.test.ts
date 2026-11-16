import { expect, test } from "bun:test";
import { buildSearchBody } from "./index";

test("single values go to filters as {field,value,operator}", () => {
  const b = buildSearchBody({ q: "reactor", docket: "05000390", author: "Smith", library: "main", order: "desc" });
  expect(b.q).toBe("reactor");
  expect(b.filters).toEqual([
    { field: "DocketNumber", value: "05000390", operator: "equals" },
    { field: "AuthorName", value: "Smith", operator: "contains" },
  ]);
  expect(b.anyFilters).toEqual([]);
  expect(b.mainLibFilter).toBe(true);
  expect(b.legacyLibFilter).toBe(false);
  expect(b.sortDirection).toBe(1);
});

test("multiple values go to anyFilters (OR)", () => {
  const b = buildSearchBody({ docket: ["a", "b"], type: "Letter" });
  expect(b.anyFilters).toEqual([
    { field: "DocketNumber", value: "a", operator: "equals" },
    { field: "DocketNumber", value: "b", operator: "equals" },
  ]);
  expect(b.filters).toEqual([{ field: "DocumentType", value: "Letter", operator: "equals" }]);
});

test("date range becomes one OData DocumentDate filter; quotes are escaped", () => {
  expect(buildSearchBody({ from: "2020-01-01", to: "2020-12-31" }).filters).toEqual([
    { field: "DocumentDate", value: "(DocumentDate ge '2020-01-01' and DocumentDate le '2020-12-31')" },
  ]);
  expect(buildSearchBody({ from: "2020-01-01" }).filters[0]).toMatchObject({ value: "(DocumentDate ge '2020-01-01')" });
  expect(buildSearchBody({ from: "x' or 1 eq 1 or 'y" }).filters[0]).toMatchObject({ value: expect.stringContaining("x'' or") });
});

test("library defaults to both; main/legacy restrict", () => {
  expect(buildSearchBody({})).toMatchObject({ mainLibFilter: true, legacyLibFilter: true });
  expect(buildSearchBody({ library: "legacy" })).toMatchObject({ mainLibFilter: false, legacyLibFilter: true });
});
