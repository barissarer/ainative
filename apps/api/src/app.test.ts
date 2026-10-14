import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { openDb } from "./db";
import { MockProvider } from "./llm/mock";

describe("api", () => {
  it("qualifies a client via chat, stores it, and refines into a new version", async () => {
    const db = await openDb("memory://");
    const app = await buildApp(db, new MockProvider());
    await app.listen({ port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;

    const read = async (body: object) => {
      const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await res.text();
      const m = text.match(/event: result\ndata: (.*)\n/);
      return JSON.parse(m![1]);
    };

    const first = await read({ message: "Qualify Acme Insurance, mid-size P&C insurer in the UK" });
    expect(first.qualification.version).toBe(1);
    expect(first.qualification.dimensions).toHaveLength(7);
    expect(first.qualification.gate.status).toBe("unresolved");
    expect(first.qualification.tier).not.toBe("Pursue now"); // gate blocks Pursue now

    const second = await read({ message: "Weight executive relationship higher", client_id: first.client.id });
    expect(second.qualification.version).toBe(2);
    expect(second.qualification.weights.exec_relationship).toBeGreaterThan(first.qualification.weights.exec_relationship);

    const list = await (await fetch(`${base}/api/clients`)).json();
    expect(list).toHaveLength(1);
    const log = await (await fetch(`${base}/api/audit-log`)).json();
    expect(log.length).toBe(2);
    await app.close();
  });
});
