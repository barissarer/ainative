import { describe, expect, it } from "vitest";
import { applyFilter, describeFilter, EMPTY_FILTER, type SearchFilter } from "./search";
import type { ClientRow } from "./clients";
import { MockProvider } from "./llm/mock";
import { buildApp } from "./app";
import { openDb } from "./db";

const row = (o: Partial<ClientRow>): ClientRow => ({
  id: "x", name: "X", sector: "Banking", region: null, owner: null, score: 50, tier: "Nurture", confidence: "Med", version: 1, updated_at: "2026-01-01T00:00:00Z",
  gate_status: "none", exec_score: 3, brand_score: 3, in_campaign: false, statuses: [], ...o,
});
const f = (o: Partial<SearchFilter>): SearchFilter => ({ ...EMPTY_FILTER, ...o });
const rows = [
  row({ id: "a", name: "Alpha Bank", sector: "Banking", tier: "Pursue now", confidence: "Low", score: 82, exec_score: 5, gate_status: "none" }),
  row({ id: "b", name: "Beta Insurance", sector: "Insurance", tier: "Nurture (advisory-only)", score: 60, gate_status: "restricted", statuses: ["Audit restriction"] }),
  row({ id: "c", name: "Gamma Bank", sector: "Banking", tier: "Pursue now", confidence: "High", score: 75, exec_score: 2, gate_status: "none", statuses: ["Awaiting leader input"] }),
  row({ id: "d", name: "Delta Retail", sector: "Retail & Consumer", tier: "Deprioritize", score: 20, gate_status: "unresolved" }),
];
const ids = (r: ClientRow[]) => r.map((x) => x.id);

describe("applyFilter", () => {
  it("filters by sector, tier and confidence (the brief's first example)", () => {
    expect(ids(applyFilter(rows, f({ sectors: ["Banking"], tiers: ["Pursue now"], confidence: ["Low"] })))).toEqual(["a"]);
  });
  it("strong exec access and no audit relationship (the brief's second example)", () => {
    expect(ids(applyFilter(rows, f({ tiers: ["Pursue now"], exec_access: "strong", audit_relationship: "none" })))).toEqual(["a"]);
  });
  it("Nurture also matches the advisory-only variant", () => {
    expect(ids(applyFilter(rows, f({ tiers: ["Nurture"] })))).toEqual(["b"]);
  });
  it("status chips, gate, score range, name and sort", () => {
    expect(ids(applyFilter(rows, f({ statuses: ["Awaiting leader input"] })))).toEqual(["c"]);
    expect(ids(applyFilter(rows, f({ gate: ["restricted", "unresolved"] })))).toEqual(["b", "d"]);
    expect(ids(applyFilter(rows, f({ min_score: 70, max_score: 80 })))).toEqual(["c"]);
    expect(ids(applyFilter(rows, f({ name_contains: "bank" })))).toEqual(["a", "c"]);
    expect(ids(applyFilter(rows, f({ sort: "name" })))).toEqual(["a", "b", "d", "c"].sort((x, y) => rows.find((r) => r.id === x)!.name.localeCompare(rows.find((r) => r.id === y)!.name)));
  });
  it("an empty filter returns everyone, ranked by score", () => {
    expect(ids(applyFilter(rows, EMPTY_FILTER))).toEqual(["a", "c", "b", "d"]);
  });
  it("describes what it understood in plain English", () => {
    expect(describeFilter(f({ sectors: ["Banking"], exec_access: "strong", audit_relationship: "none" }))).toEqual(["Sector: Banking", "Executive access: strong", "No audit relationship"]);
  });
});

describe("mock query parser", () => {
  const p = new MockProvider();
  it("understands the brief's examples", async () => {
    const a = await p.parseSearch("show me banking clients rated Pursue now with low confidence");
    expect(a).toMatchObject({ sectors: ["Banking"], tiers: ["Pursue now"], confidence: ["Low"] });
    const b = await p.parseSearch("Pursue-now clients where executive access is strong and there's no audit relationship");
    expect(b).toMatchObject({ tiers: ["Pursue now"], exec_access: "strong", audit_relationship: "none" });
  });
  it("falls back to a name search for unrecognised text", async () => {
    expect((await p.parseSearch("acme")).name_contains).toBe("acme");
  });
});

describe("search API", () => {
  it("returns matching rows plus what was understood", async () => {
    const db = await openDb("memory://");
    const app = await buildApp(db, new MockProvider());
    await app.listen({ port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    for (const m of ["Qualify Northwind Bank, regional bank in Germany", "Qualify Acme Insurance, UK insurer"]) {
      await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: m }) }).then((r) => r.text());
    }
    const r = await fetch(`${base}/api/clients/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "banking clients" }) });
    const j = await r.json();
    expect(j.understood).toEqual(["Sector: Banking"]);
    expect(j.rows.map((x: any) => x.name)).toEqual(["Northwind Bank"]);
    expect((await fetch(`${base}/api/clients/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: " " }) })).status).toBe(400);
    await app.close();
  });
});
