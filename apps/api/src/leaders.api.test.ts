import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { openDb } from "./db";
import { MockProvider } from "./llm/mock";

async function setup() {
  const db = await openDb("memory://");
  const app = await buildApp(db, new MockProvider());
  await app.listen({ port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-user": user }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, json: () => JSON.parse(text), text };
  };
  const chat = async (user: string, message: string, client_id?: string) => {
    const r = await call("POST", "/api/chat", user, { message, client_id });
    return JSON.parse(r.text.match(/event: result\ndata: (.*)\n/)![1]);
  };
  return { app, db, call, chat };
}
const lens = (o: any = {}) => ({
  brand_permission: { rating: "Strong", comment: "Lots of strategic work" },
  audit_status: { status: "not_audit_client" },
  exec_relationship: { seniority: "CEO", quality: "Strong", receptiveness: "Yes" },
  source: "structured", ...o,
});

describe("account leader flow", () => {
  it("requests, collects split views, applies them and keeps them across AI re-runs", async () => {
    const { app, call, chat } = await setup();
    const first = await chat("casey", "Qualify Acme Insurance, UK P&C insurer");
    const cid = first.client.id;

    // Casey asks two leaders
    const req = await call("POST", `/api/clients/${cid}/leader-requests`, "casey", { assignee_ids: ["priya", "sam"] });
    expect(req.json().created).toHaveLength(2);
    expect((await call("GET", "/api/leader-requests", "priya")).json()).toHaveLength(1);
    expect((await call("GET", "/api/notifications", "priya")).json()[0].kind).toBe("leader_request");
    expect((await call("GET", "/api/clients", "casey")).json()[0].statuses).toContain("Awaiting leader input");

    const [rPriya] = (await call("GET", "/api/leader-requests", "priya")).json();
    const [rSam] = (await call("GET", "/api/leader-requests", "sam")).json();

    // Nobody can answer someone else's request
    expect((await call("POST", `/api/leader-requests/${rPriya.id}/submit`, "sam", lens())).status).toBe(403);

    // Incomplete answers are rejected
    expect((await call("POST", `/api/leader-requests/${rPriya.id}/submit`, "priya", { brand_permission: { rating: "Strong" } })).status).toBe(400);

    // Priya: strong; Sam: weak access. Views disagree.
    const a = await call("POST", `/api/leader-requests/${rPriya.id}/submit`, "priya", lens());
    expect(a.status).toBe(200);
    const b = await call("POST", `/api/leader-requests/${rSam.id}/submit`, "sam", lens({ exec_relationship: { seniority: "Director", quality: "Weak", receptiveness: "No" } }));
    const q = b.json().qualification;
    expect(q.version).toBe(3);
    expect(q.leader_summary.disagreements.join(" ")).toContain("1 of 2".replace("1 of 2", "1 of 2")); // split reported
    expect(q.leader_summary.leaders).toHaveLength(2);
    const exec = q.dimensions.find((d: any) => d.key === "exec_relationship");
    expect(exec.origin).toBe("Leader-informed");
    expect(exec.score).toBe(1); // conservative
    expect(q.gate.status).toBe("none"); // both said not an audit client

    // Each input is linked to the version it reacted to
    const inputs = (await call("GET", "/api/audit-log", "casey")).json().filter((x: any) => x.action === "leader_input.submitted");
    expect(inputs).toHaveLength(2);
    expect((await call("GET", "/api/clients", "casey")).json()[0].statuses).toEqual(expect.arrayContaining(["Leader-informed"]));

    // AI re-run: weights change, leader input and gate survive
    const refined = await chat("casey", "Weight client circumstances higher", cid);
    const rexec = refined.qualification.dimensions.find((d: any) => d.key === "exec_relationship");
    expect(rexec.origin).toBe("Leader-informed");
    expect(rexec.score).toBe(1);
    expect(refined.qualification.gate.status).toBe("none");
    await app.close();
  });

  it("audit gate: leader answer restricts, only Risk can clear, with a logged reason", async () => {
    const { app, call, chat } = await setup();
    const first = await chat("casey", "Qualify Northwind Bank");
    const cid = first.client.id;
    await call("POST", `/api/clients/${cid}/leader-requests`, "casey", { assignee_ids: ["alex"] });
    const [r] = (await call("GET", "/api/leader-requests", "alex")).json();
    const sub = await call("POST", `/api/leader-requests/${r.id}/submit`, "alex", lens({ audit_status: { status: "audit_client" } }));
    let q = sub.json().qualification;
    expect(q.gate.status).toBe("restricted");
    expect(q.tier).toBe("Nurture (advisory-only)");

    // Consultants, leaders and leadership cannot touch the gate
    for (const u of ["casey", "alex", "lee"]) {
      const res = await call("POST", `/api/clients/${cid}/gate`, u, { status: "cleared", reason: "trying" });
      expect(res.status).toBe(403);
    }
    // Risk needs a reason
    expect((await call("POST", `/api/clients/${cid}/gate`, "riley", { status: "cleared", reason: "  " })).status).toBe(400);
    const ok = await call("POST", `/api/clients/${cid}/gate`, "riley", { status: "cleared", reason: "Independence review ref 123 completed" });
    expect(ok.status).toBe(200);
    q = ok.json().qualification;
    expect(q.gate).toMatchObject({ status: "cleared", cleared_by: "Riley Risk" });

    // Leaders cannot loosen it again, and re-running the AI cannot overwrite it
    const refined = await chat("casey", "Weight sector dynamics lower", cid);
    expect(refined.qualification.gate.status).toBe("cleared");

    const log = (await call("GET", "/api/audit-log", "casey")).json();
    expect(log.some((x: any) => x.action === "gate.change_denied")).toBe(true);
    const changed = log.filter((x: any) => x.action === "gate.changed");
    expect(changed.some((x: any) => x.reason === "Independence review ref 123 completed")).toBe(true);
    expect((await call("GET", `/api/clients/${cid}/gate-history`, "riley")).json().length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  it("'Unsure' blocks Pursue now and notifies Risk", async () => {
    const { app, call, chat } = await setup();
    const first = await chat("casey", "Qualify Contoso Energy");
    await call("POST", `/api/clients/${first.client.id}/leader-requests`, "casey", { assignee_ids: ["priya"] });
    const [r] = (await call("GET", "/api/leader-requests", "priya")).json();
    const sub = await call("POST", `/api/leader-requests/${r.id}/submit`, "priya", lens({ audit_status: { status: "unsure" } }));
    expect(sub.json().qualification.gate.status).toBe("unresolved");
    expect(sub.json().qualification.tier).not.toBe("Pursue now");
    expect((await call("GET", "/api/notifications", "riley")).json().some((n: any) => n.kind === "audit_unsure")).toBe(true);
    await app.close();
  });

  it("maps free text to the lenses as a draft only, and hides leader comments from leadership", async () => {
    const { app, call, chat } = await setup();
    const first = await chat("casey", "Qualify Fabrikam Retail");
    const cid = first.client.id;
    await call("POST", `/api/clients/${cid}/leader-requests`, "casey", { assignee_ids: ["priya"] });
    const [r] = (await call("GET", "/api/leader-requests", "priya")).json();

    const draft = (await call("POST", `/api/leader-requests/${r.id}/map`, "priya", { text: "We've done lots of cost work there but nothing strategic, and the CEO barely knows us" })).json();
    expect(draft.brand_permission.rating).toBe("Weak");
    expect(draft.exec_relationship.quality).toBe("Weak");
    expect(draft.audit_status).toBeNull(); // never guessed
    expect((await call("GET", `/api/clients/${cid}`, "casey")).json().qualification.version).toBe(1); // nothing saved

    await call("POST", `/api/leader-requests/${r.id}/submit`, "priya", lens({ source: "conversational", brand_permission: { rating: "Weak", comment: "Secret candid remark" } }));
    const asLeadership = (await call("GET", `/api/clients/${cid}`, "lee")).json().qualification;
    expect(JSON.stringify(asLeadership)).not.toContain("Secret candid remark");
    const asConsultant = (await call("GET", `/api/clients/${cid}`, "casey")).json().qualification;
    expect(JSON.stringify(asConsultant)).toContain("Secret candid remark");
    await app.close();
  });
});
