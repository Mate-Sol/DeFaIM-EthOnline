import React from 'react';

// --- Table Context ---
const TableContext = React.createContext({ variant: 'body', density: 'normal' });

// --- TableContainer ---
const TableContainer = ({ children, className = '' }) => {
  return (
    <div className={`w-full overflow-hidden rounded-2xl bg-table-bg/30 backdrop-blur-lg border border-white/10 shadow-lg ${className}`}>
      <div className="overflow-x-auto no-scrollbar">
        {children}
      </div>
    </div>
  );
};

// --- Table ---
const Table = ({ children, className = '', density = 'normal' }) => {
  return (
    <TableContext.Provider value={{ variant: 'body', density }}>

      <table className={`w-full text-left rounded-2xl border-collapse whitespace-nowrap ${className}`}>
        {children}
      </table>

    </TableContext.Provider>
  );
};

// --- TableHead ---
const TableHead = ({ children, className = '' }) => {
  const { density } = React.useContext(TableContext);
  return (
    <TableContext.Provider value={{ variant: 'head', density }}>
      <thead className={`${className}`}>
        {children}
      </thead>
    </TableContext.Provider>
  );
};

// --- TableBody ---
const TableBody = ({ children, className = '' }) => {
  const { density } = React.useContext(TableContext);
  return (
    <TableContext.Provider value={{ variant: 'body', density }}>
      <tbody className={`${className}`}>
        {children}
      </tbody>
    </TableContext.Provider>
  );
};

// --- TableFooter ---
const TableFooter = ({ children, className = '' }) => {
  const { density } = React.useContext(TableContext);
  return (
    <TableContext.Provider value={{ variant: 'footer', density }}>
      <tfoot className={`${className}`}>
        {children}
      </tfoot>
    </TableContext.Provider>
  );
};

// --- TableRow ---
const TableRow = ({ children, className = '', hover = true }) => {
  const { variant, density } = React.useContext(TableContext);
  const isHead = variant === 'head';

  return (
    <tr
      className={`
        ${isHead ? 'border-b-[0.5px] border-white/50 bg-primary-light bg-blur-md' : 'border-b-[0.5px] border-white/50 last:border-0'}
        ${hover && !isHead ? 'transition-colors hover:bg-white/5' : ''}
        ${className}
      `}
    >
      {children}
    </tr>
  );
};

// --- TableCell ---
const TableCell = ({ children, className = '', align = 'left', padding, ...rest }) => {
  const { variant, density } = React.useContext(TableContext);
  const isHead = variant === 'head';

  const Component = isHead ? 'th' : 'td';

  const alignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  // Resolve padding based on prop or global density
  const activePadding = padding || (density === 'relaxed' ? 'relaxed' : density === 'dense' ? 'tight' : 'normal');

  const paddingClasses = {
    relaxed: 'px-8 py-6',
    normal: 'px-6 py-4',
    tight: 'px-6 py-2',
    none: 'p-0',
    header: density === 'relaxed' ? 'px-8 py-6' : 'px-6 py-4',
  };

  return (
    <Component
      {...rest}
      className={`
        ${alignClasses[align]} 
        ${isHead ? paddingClasses.header : paddingClasses[activePadding]}
        ${isHead ? 'font-medium text-sm text-white' : 'text-slate-200'}
        
        ${className}
      `}
    >
      {children}
    </Component>
  );
};

// --- TablePagination ---
const TablePagination = ({
  count,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  className = ''
}) => {
  return (
    <div className={`flex items-center justify-end px-6 py-3 border-t border-white/10 text-slate-300 text-sm ${className}`}>
      <div className="flex items-center gap-4">
        <span>Rows per page: {rowsPerPage}</span>
        <span>{page * rowsPerPage + 1}-{Math.min((page + 1) * rowsPerPage, count)} of {count}</span>
        <div className="flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
            className="p-1 hover:bg-white/10 rounded-full disabled:opacity-30"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button
            disabled={(page + 1) * rowsPerPage >= count}
            onClick={() => onPageChange(page + 1)}
            className="p-1 hover:bg-white/10 rounded-full disabled:opacity-30"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export {
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableFooter,
  TablePagination
};
