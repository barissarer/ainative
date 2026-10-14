import { NavLink, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Clients from "./pages/Clients";
import { Compare, MyRequests } from "./pages/Stubs";

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 text-sm font-medium border-b-2 ${isActive ? "border-brand text-black" : "border-transparent text-neutral-500 hover:text-black"}`;

export default function App() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-6 border-b border-neutral-200 px-5 py-2">
        <div className="text-sm font-bold">
          AI Native NewCo <span className="text-brand-dark">Campaign Hub</span>
        </div>
        <nav className="flex gap-1">
          <NavLink to="/" end className={link}>Home</NavLink>
          <NavLink to="/clients" className={link}>Clients</NavLink>
          <NavLink to="/compare" className={link}>Compare</NavLink>
          <NavLink to="/requests" className={link}>My Requests</NavLink>
        </nav>
        <div className="ml-auto text-xs text-neutral-500">Handle client data per firm policy.</div>
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/requests" element={<MyRequests />} />
        </Routes>
      </main>
    </div>
  );
}
