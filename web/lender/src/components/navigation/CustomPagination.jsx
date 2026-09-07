import React from "react";

const CustomPagination = ({ currentPage, totalPage, setCurrentPage }) => {
  const getPages = () => {
    if (totalPage <= 4) {
      return Array.from({ length: totalPage }, (_, i) => i + 1);
    }

    const pages = [];

    // Always show first 2
    pages.push(1);
    if (totalPage > 1) pages.push(2);

    // Show ellipsis if current page is far from start
    if (currentPage > 3) {
      pages.push("...");
    }

    // Show current page if it's not already in the list
    if (currentPage > 2 && currentPage < totalPage - 1) {
      pages.push(currentPage);
    }

    // Show ellipsis if current page is far from end
    if (currentPage < totalPage - 2) {
      pages.push("...");
    }

    // Always show last page
    if (totalPage > 2) pages.push(totalPage);

    // Deduplicate
    return [...new Set(pages)];
  };

  const pages = getPages();

  const btnBase =
    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-200 select-none";

  return (
    <div className="flex justify-center items-center gap-2 mt-6 mb-6">
      {/* Prev */}
      <button
        onClick={() => currentPage > 1 && setCurrentPage(currentPage - 1)}
        disabled={currentPage === 1}
        className={`${btnBase} border border-white/20 bg-pagination-inactive/40 text-white/70 hover:bg-white/15 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        ‹
      </button>

      {pages.map((page, idx) =>
        page === "..." ? (
          <span
            key={`ellipsis-${idx}`}
            className={`${btnBase} border border-white/10 bg-white/5 text-white/40 cursor-default`}
          >
            ...
          </span>
        ) : (
          <button
            key={page}
            onClick={() => setCurrentPage(page)}
            className={`${btnBase} ${
              currentPage === page
                ? "border border-pagination-active bg-pagination-active/30 text-white shadow-[0_0_12px_rgba(66,46,165,0.4)] ring-2 ring-purple-500"
                : "border border-white/20 bg-pagination-inactive/40 text-white/70 hover:bg-white/15 hover:text-white hover:border-white/40"
            }`}
          >
            {page}
          </button>
        )
      )}

      {/* Next */}
      <button
        onClick={() => currentPage < totalPage && setCurrentPage(currentPage + 1)}
        disabled={currentPage === totalPage}
        className={`${btnBase} border border-white/20 bg-pagination-inactive/40 text-white/70 hover:bg-white/15 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        ›
      </button>
    </div>
  );
};

export default CustomPagination;
