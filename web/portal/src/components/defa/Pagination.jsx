import { ChevronLeft, ChevronRight } from 'lucide-react';

// Compact Prev/Next + page indicator. Reads {page, totalPages, hasPrev, hasNext}
// from the daily-activity payload's pagination block and emits a new page
// number to the parent's onChange.
const Pagination = ({ pagination, onChange, label }) => {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, limit, totalDays, totalPages, hasPrev, hasNext } = pagination;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, totalDays);
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10 text-xs">
      <div className="text-white/60">
        {label || 'Days'} {start}–{end} of {totalDays}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => hasPrev && onChange(page - 1)}
          disabled={!hasPrev}
          className="defa-btn-ghost px-2 py-1 disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="px-3 text-white/80 tabular-nums">
          {page} / {totalPages}
        </div>
        <button
          onClick={() => hasNext && onChange(page + 1)}
          disabled={!hasNext}
          className="defa-btn-ghost px-2 py-1 disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
