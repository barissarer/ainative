import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { openDb } from "./db";
import { MockProvider } from "./llm/mock";
import { BULK_LIMIT, parseNames } from "./bulk";
import { buildOnePager } from "./campaign";

async function setup() {
  const db = await openDb("memory://");
  const app = await buildApp(db, new MockProvider());
  await app.listen({ port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const call = (method: string, path: string, user = "casey", body?: unknown) =>
    fetch(base + path, { method, headers: { "content-type": "application/json", "x-user": user }, body: body ? JSON.stringify(body) : undefined });
  return { app, call };
}
const events = (text: string) => [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ ev: m[1], data: JSON.parse(m[2]) }));

describe("parseNames", () => {
  it("handles lines, commas, quotes, header rows and duplicates", () => {
    expect(parseNames('Client\nAcme Insurance\n"Northwind Bank"\nacme insurance\n\nContoso Energy')).toEqual(["Acme Insurance", "Northwind Bank", "Contoso Energy"]);
    expect(parseNames("A, B, C")).toEqual(["A", "B", "C"]); // one line = a list of names
    expect(parseNames("A; B")).toEqual(["A", "B"]);
  });
  it("keeps context on a line instead of splitting it into separate clients", () => {
    expect(parseNames("Acme Insurance, UK P&C insurer\nNorthwind Bank, Germany")).toEqual(["Acme Insurance, UK P&C insurer", "Northwind Bank, Germany"]);
    expect(parseNames("Acme Insurance, UK insurer\nacme insurance")).toHaveLength(1);
  });
});

describe("bulk mode", () => {
  it("ranks a pasted list, skips clients already qualified, and each result is a normal qualification", async () => {
    const { app, call } = await setup();
    await call("POST", "/api/chat", "casey", { message: "Qualify Acme Insurance" }).then((r) => r.text());
    const res = await call("POST", "/api/bulk", "casey", { text: "Acme Insurance\nNorthwind Bank\nContoso Energy" });
    const ev = events(await res.text());
    expect(ev.find((e) => e.ev === "start")!.data.total).toBe(3);
    const items = ev.filter((e) => e.ev === "item").map((e) => `${e.data.name}:${e.data.status}`).sort();
    expect(items).toEqual(["Acme Insurance:existing", "Contoso Energy:done", "Northwind Bank:done"]);
    const done = ev.find((e) => e.ev === "done")!.data;
    expect(done.ranked).toHaveLength(3);
    const scores = done.ranked.map((r: any) => r.score);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
    const versions = await (await call("GET", `/api/clients/${done.ranked[0].id}/versions`)).json();
    expect(versions.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });
  it("rejects empty, oversize and unauthorised runs", async () => {
    const { app, call } = await setup();
    expect((await call("POST", "/api/bulk", "casey", { text: "  " })).status).toBe(400);
    expect((await call("POST", "/api/bulk", "casey", { names: Array.from({ length: BULK_LIMIT + 1 }, (_, i) => `Client ${i}`) })).status).toBe(400);
    expect((await call("POST", "/api/bulk", "lee", { text: "Acme" })).status).toBe(403);
    await app.close();
  });
});

describe("one-pager, campaign and hand-off", () => {
  it("exports a PDF, saves to campaign, and hands off a package without leader commentary", async () => {
    const { app, call } = await setup();
    const first = JSON.parse((await (await call("POST", "/api/chat", "casey", { message: "Qualify Acme Insurance" })).text()).match(/event: result\ndata: (.*)\n/)![1]);
    const cid = first.client.id;
    await call("POST", `/api/clients/${cid}/leader-requests`, "casey", { assignee_ids: ["priya"] });
    const [r] = await (await call("GET", "/api/leader-requests", "priya")).json();
    await call("POST", `/api/leader-requests/${r.id}/submit`, "priya", {
      brand_permission: { rating: "Strong", comment: "SECRET-BRAND-NOTE" }, audit_status: { status: "audit_client", comment: "SECRET-AUDIT-NOTE" },
      exec_relationship: { seniority: "CEO", quality: "Strong", receptiveness: "Yes", comment: "SECRET-EXEC-NOTE" }, source: "structured",
    });

    const pdf = await call("GET", `/api/clients/${cid}/onepager.pdf`, "casey");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await pdf.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
    // The shipped PDF is compressed, so also render the same document uncompressed and look for leaked commentary.
    const full: any = await (await call("GET", `/api/clients/${cid}`, "casey")).json();
    expect(JSON.stringify(full.qualification)).toContain("SECRET-BRAND-NOTE"); // the data does contain it...
    const plain = (await buildOnePager(full.client, full.qualification, { compress: false })).toString("latin1");
    expect(plain).toContain("Acme Insurance"); // ...and the uncompressed render is readable
    expect(plain).not.toContain("SECRET-"); // ...but the one-pager must not print it

    expect((await call("POST", `/api/clients/${cid}/campaign`, "lee", { in_campaign: true })).status).toBe(403);
    expect((await (await call("POST", `/api/clients/${cid}/campaign`, "casey", { in_campaign: true })).json()).in_campaign).toBe(true);
    expect((await (await call("GET", "/api/clients")).json())[0].statuses).toContain("In campaign");

    const h = await (await call("GET", `/api/clients/${cid}/handoff`, "casey")).json();
    expect(h).toMatchObject({ schema: "ainative.qualification-handoff", schema_version: 1 });
    expect(h.gate.restricted).toBe(true);
    expect(JSON.stringify(h)).not.toContain("SECRET-");
    expect(h.qualification.dimensions).toHaveLength(7);

    const log = await (await call("GET", "/api/audit-log")).json();
    expect(log.map((x: any) => x.action)).toEqual(expect.arrayContaining(["export.onepager", "campaign.saved", "handoff.exported"]));
    expect((await call("GET", "/api/clients/nope/onepager.pdf")).status).toBe(404);
    await app.close();
  });
});
