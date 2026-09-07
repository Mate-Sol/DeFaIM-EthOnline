export function KpiCard({ label, value, change }) {
  const trendColor = change >= 0 ? "text-emerald-400" : "text-rose-400";

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className={`mt-2 text-xs font-medium ${trendColor}`}>
        {change >= 0 ? "+" : ""}
        {change.toFixed(2)}% (24h)
      </p>
    </article>
  );
}
