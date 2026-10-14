export function TierBadge({ tier }: { tier: string }) {
  const style = tier === "Pursue now" ? "bg-brand text-black" : tier.startsWith("Nurture") ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-700";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${style}`}>{tier}</span>;
}

/** One-tap choice row. */
export function Choice<T extends string>({ value, options, onChange, labels }: { value: T | ""; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} className={`rounded-md border px-3 py-1.5 text-sm ${value === o ? "border-brand-dark bg-brand font-semibold text-black" : "border-neutral-300 hover:bg-neutral-50"}`}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}
