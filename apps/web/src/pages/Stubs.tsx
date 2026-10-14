const Stub = ({ title, text }: { title: string; text: string }) => (
  <div className="mx-auto max-w-xl p-10 text-center">
    <h1 className="text-lg font-semibold">{title}</h1>
    <p className="mt-2 text-sm text-neutral-600">{text}</p>
  </div>
);
export const Compare = () => <Stub title="Compare clients" text="Side-by-side comparison of 2-4 clients arrives in a later phase." />;
export const MyRequests = () => <Stub title="My requests" text="Clients awaiting your input will appear here once account leader input is built (Phase 3)." />;
