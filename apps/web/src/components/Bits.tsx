export function TierBadge({ tier }: { tier: string }) {
  const style = tier === "Pursue now" ? "bg-brand text-black" : tier.startsWith("Nurture") ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-700";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${style}`}>{tier}</span>;
}
