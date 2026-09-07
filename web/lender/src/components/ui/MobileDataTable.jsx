import React, { useState } from "react";
import Card from "./Card";
import { ChevronLeft, ChevronRight, LayoutGrid, Table2 } from "lucide-react";
import {
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./Table";
import Tooltip from "./Tooltip";

const InfoIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="inline-block ml-1 opacity-70 cursor-pointer"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

/**
 * MobileDataTable — card or table view for mobile with navigation + view toggle
 *
 * @param {Array}    columns        - [{ key, label, align?, info?, render? }]
 * @param {Array}    data           - array of row objects
 * @param {string}   className      - optional wrapper class
 * @param {number}   currentPage    - current page number
 * @param {number}   totalPage      - total number of pages
 * @param {function} onPageChange   - callback when page changes
 * @param {boolean}  showNavigation - show/hide navigation buttons
 * @param {node}     plusDropdown   - optional PlusDropdown node to render in header
 */
const MobileDataTable = ({
  columns = [],
  data = [],
  className = "",
  currentPage = 1,
  totalPage = 1,
  onPageChange,
  showNavigation = true,
  plusDropdown,
}) => {
  const [viewMode, setViewMode] = useState("card"); // "card" | "table"

  const handlePrevious = () => {
    if (currentPage > 1 && onPageChange) onPageChange(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPage && onPageChange) onPageChange(currentPage + 1);
  };

  return (
    <div className={className}>
      {/* Toolbar: view toggle + plus dropdown */}
      <div className="flex items-center justify-between mb-3">
        {/* Toggle pill */}
        <div className="flex items-center gap-1 p-1 rounded-full border border-white/15 bg-white/5 backdrop-blur-md">
          <button
            onClick={() => setViewMode("card")}
            title="Card view"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
              viewMode === "card"
                ? "bg-white/20 text-white shadow-sm"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            <LayoutGrid size={13} />
            Cards
          </button>
          <button
            onClick={() => setViewMode("table")}
            title="Table view"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
              viewMode === "table"
                ? "bg-white/20 text-white shadow-sm"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            <Table2 size={13} />
            Table
          </button>
        </div>

        {/* Plus dropdown slot */}
        {plusDropdown && <div>{plusDropdown}</div>}
      </div>

      {/* Card View */}
      {viewMode === "card" && (
        <div className="space-y-3">
          {data.map((row, rowIndex) => (
            <Card
              key={rowIndex}
              variant="glass"
              className="p-4! rounded-2xl! hover:border-white/40 transition-all duration-200"
            >
              <div className="space-y-0">
                {columns.map((col, colIndex) => (
                  <div
                    key={col.key}
                    className={`flex justify-between items-center gap-4 py-2.5 ${
                      colIndex !== columns.length - 1
                        ? "border-b border-white/8"
                        : ""
                    }`}
                  >
                    <span className="text-white/45 text-xs font-medium uppercase tracking-wider shrink-0">
                      {col.label}
                    </span>
                    <div className="text-white text-sm font-semibold text-right">
                      {col.render ? col.render(row, row[col.key]) : row[col.key]}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <div className="overflow-x-auto">
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {columns.map((col) => (
                    <TableCell key={col.key} align={col.align || "left"}>
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.info !== false && (
                          <Tooltip text={col.infoText || col.label} position={col.infoPosition || "top"}>
                            <InfoIcon />
                          </Tooltip>
                        )}
                      </span>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col.key} align={col.align || "left"}>
                        {col.render ? col.render(row, row[col.key]) : row[col.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      )}

      {/* Navigation */}
      {showNavigation && totalPage > 1 && (
        <div className="flex items-center justify-between mt-5">
          {/* Previous */}
          <button
            onClick={handlePrevious}
            disabled={currentPage === 1}
            className={`group flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium backdrop-blur-md transition-all duration-200 ${
              currentPage === 1
                ? "border-white/8 bg-white/4 text-white/25 cursor-not-allowed"
                : "border-white/20 bg-white/8 text-white/80 hover:bg-white/15 hover:border-white/35 hover:text-white active:scale-95"
            }`}
          >
            <ChevronLeft
              size={16}
              className={`transition-transform duration-200 ${currentPage !== 1 ? "group-hover:-translate-x-0.5" : ""}`}
            />
            Prev
          </button>

          {/* Page dots / counter */}
          <div className="flex items-center gap-1.5">
            {totalPage <= 7 ? (
              Array.from({ length: totalPage }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => onPageChange?.(i + 1)}
                  className={`rounded-full transition-all duration-200 ${
                    currentPage === i + 1
                      ? "w-5 h-2 bg-white"
                      : "w-2 h-2 bg-white/25 hover:bg-white/50"
                  }`}
                />
              ))
            ) : (
              <span className="text-white/50 text-xs">
                <span className="text-white font-semibold">{currentPage}</span>
                {" / "}
                <span className="text-white/70">{totalPage}</span>
              </span>
            )}
          </div>

          {/* Next */}
          <button
            onClick={handleNext}
            disabled={currentPage === totalPage}
            className={`group flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium backdrop-blur-md transition-all duration-200 ${
              currentPage === totalPage
                ? "border-white/8 bg-white/4 text-white/25 cursor-not-allowed"
                : "border-white/20 bg-white/8 text-white/80 hover:bg-white/15 hover:border-white/35 hover:text-white active:scale-95"
            }`}
          >
            Next
            <ChevronRight
              size={16}
              className={`transition-transform duration-200 ${currentPage !== totalPage ? "group-hover:translate-x-0.5" : ""}`}
            />
          </button>
        </div>
      )}
    </div>
  );
};

export default MobileDataTable;
