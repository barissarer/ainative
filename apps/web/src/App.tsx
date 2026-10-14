import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Clients from "./pages/Clients";
import MyRequests from "./pages/MyRequests";
import LeaderReview from "./pages/LeaderReview";
import { Compare } from "./pages/Stubs";
import { api, getUserId, setUserId, type DemoUser } from "./api";

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 text-sm font-medium border-b-2 ${isActive ? "border-brand text-black" : "border-transparent text-neutral-500 hover:text-black"}`;

export default function App() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [uid, setUid] = useState(getUserId());
  const [pending, setPending] = useState(0);
  const me = users.find((u) => u.id === uid) ?? { id: uid, name: "", role: "consultant", title: "" };

  useEffect(() => { api<DemoUser[]>("GET", "/api/users").then(setUsers).catch(() => {}); }, []);
  useEffect(() => {
    const load = () => api<any[]>("GET", "/api/leader-requests").then((r) => setPending(r.filter((x) => x.status === "pending").length)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [uid]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-neutral-200 px-5 py-2">
        <div className="text-sm font-bold">AI Native NewCo <span className="text-brand-dark">Campaign Hub</span></div>
        <nav className="flex gap-1">
          <NavLink to="/" end className={link}>Home</NavLink>
          <NavLink to="/clients" className={link}>Clients</NavLink>
          <NavLink to="/compare" className={link}>Compare</NavLink>
          <NavLink to="/requests" className={link}>My Requests{pending > 0 && <span className="ml-1.5 rounded-full bg-brand px-1.5 text-xs font-bold text-black">{pending}</span>}</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
          <span className="hidden md:inline">Handle client data per firm policy.</span>
          <label title="Demo only: there is no login yet">Viewing as{" "}
            <select className="ml-1 rounded border border-neutral-300 px-1 py-0.5 text-black" value={uid} onChange={(e) => { setUserId(e.target.value); setUid(e.target.value); }}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.title})</option>)}
            </select>
          </label>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Home role={me.role} key={uid} />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/requests" element={<MyRequests meName={me.name} />} />
          <Route path="/requests/:id" element={<LeaderReview key={uid} />} />
        </Routes>
      </main>
    </div>
  );
}
