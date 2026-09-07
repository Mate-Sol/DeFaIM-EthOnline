import React from "react";
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
 * DataTable — dynamic, reusable table component
 *
 * @param {Array} columns - [{ key, label, align?, info?, render? }]
 *   - key: matches the data object key
 *   - label: column header text
 *   - align: 'left' | 'center' | 'right' (default 'left')
 *   - info: show info icon next to header (default true)
 *   - render: optional custom cell renderer (row, value) => ReactNode
 *
 * @param {Array} data - array of row objects
 * @param {string} className - optional wrapper class
 */
const DataTable = ({
  columns = [],
  data = [],
  className = "",
  transparent = false,
}) => {
  return (
    <TableContainer
      className={`${transparent ? "!bg-transparent !border-0 !shadow-none !backdrop-blur-none" : ""} ${className}`}
    >
      <Table>
        <TableHead>
          <TableRow className={transparent ? "!bg-transparent !border-0" : ""}>
            {columns.map((col) => (
              <TableCell
                key={col.key}
                align={col.align || "left"}
                className={transparent ? "!bg-transparent !border-0" : ""}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.info !== false && (
                    <Tooltip text={col.infoText || col.label} position={"left"}>
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
  );
};

export default DataTable;
