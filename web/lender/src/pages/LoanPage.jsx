import CustomPagination from "@/components/navigation/CustomPagination";
import PlusDropdown from "@/components/navigation/PlusDropdown";
import DataTable from "@/components/ui/DataTable";
import MobileDataTable from "@/components/ui/MobileDataTable";
import InputField from "@/components/ui/InputField";
import { cn } from "@/libs/utils/utils";
import { BASE_COLUMNS, COLUMN_OPTIONS, loansData } from "@/Mock/mock_data";
import { Search } from "lucide-react";
import React, { useState } from "react";

const PAGE_SIZE = 5;

const LoanPage = ({ wrapperClassName, pagination = true }) => {
  const [search, setSearch] = useState("");
  const [columns, setColumns] = useState(BASE_COLUMNS);
  const [currentPage, setCurrentPage] = useState(1);

  const handleAddColumn = (opt) => {
    setColumns((prev) => [...prev, opt.column]);
  };

  const handleRemoveColumn = (opt) => {
    setColumns((prev) => prev.filter((c) => c.key !== opt.key));
  };

  // All options = base columns + extra column options
  const allColumnOptions = [
    ...BASE_COLUMNS.map((c) => ({ key: c.key, label: c.label, column: c })),
    ...COLUMN_OPTIONS,
  ];

  const selectedColumnKeys = columns.map((c) => c.key);

  const filtered = loansData.filter(
    (row) =>
      row.riskType.toLowerCase().includes(search.toLowerCase()) ||
      row.status.toLowerCase().includes(search.toLowerCase()),
  );

  const totalPage = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div className={cn(`p-12 `, wrapperClassName)}>
      {/* Loans Section */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-2xl md:text-3xl font-semibold text-white">Loans</h2>
        <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto md:mr-14">
          <InputField
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search size={18} />}
            className="w-full! border-white/90! placeholder:text-white/90! bg-transparent!"
            wrapperClassName="flex-1 sm:flex-none sm:w-56 md:w-full "
          />
          <button className="text-white/90 hover:text-white text-sm whitespace-nowrap transition-colors hover:underline underline-offset-2">
            View All
          </button>
        </div>
      </div>

      {/* Table with plus button — desktop only */}
      <div className="hidden md:flex items-start gap-3">
        <div className="flex-1 min-w-0 overflow-x-auto">
          <DataTable columns={columns} data={paginated} />
        </div>
        <div className="pt-3 shrink-0">
          <PlusDropdown
            options={allColumnOptions}
            selectedKeys={selectedColumnKeys}
            onSelect={handleAddColumn}
            onDeselect={handleRemoveColumn}
          />
        </div>
      </div>

      {/* Card view — mobile only */}
      <div className="md:hidden">
        <MobileDataTable
          columns={columns}
          data={paginated}
          currentPage={currentPage}
          totalPage={totalPage}
          onPageChange={setCurrentPage}
          showNavigation={pagination}
          plusDropdown={
            <PlusDropdown
              options={allColumnOptions}
              selectedKeys={selectedColumnKeys}
              onSelect={handleAddColumn}
              onDeselect={handleRemoveColumn}
            />
          }
        />
      </div>

      {/* Pagination — desktop only */}
      {pagination === true && totalPage > 1 && (
        <div className="hidden md:block">
          <CustomPagination
            currentPage={currentPage}
            totalPage={totalPage}
            setCurrentPage={setCurrentPage}
          />
        </div>
      )}
    </div>
  );
};

export default LoanPage;
