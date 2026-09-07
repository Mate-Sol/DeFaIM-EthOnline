import React, { useState } from "react";
import Card from "../components/ui/Card";
import Typography from "../components/ui/Typography";
import Chip from "../components/ui/Chip";
import CustomPagination from "../components/navigation/CustomPagination";
import DataTable from "../components/ui/DataTable";
import { Eye, Copy } from "lucide-react";
import { copyToClipboard } from "@/libs/utils/utils";

const columns = [
  { key: "date", label: "Date & Time", info: false },
  { key: "lender", label: "Lender", info: false },
  { key: "txHash", label: "Transaction Hash", info: false },
  { key: "loanAmount", label: "Loan Amount", info: false },
  {
    key: "status",
    label: "Status",
    info: false,
    render: (row) => (
      <Chip
        variant="error"
        color="error"
        className="text-xs px-3 py-1 scale-90 origin-left"
      >
        {row.status}
      </Chip>
    ),
  },
  {
    key: "action",
    label: "Action",
    info: false,
    render: (row) => (
      <div className="flex items-center gap-2">
        <button className="text-white/40 hover:text-white transition-colors">
          <Eye size={15} />
        </button>
        <button
          className="text-white/40 hover:text-white transition-colors"
          onClick={() => copyToClipboard(row.txHash, "Transaction hash copied!")}
          title="Copy transaction hash"
        >
          <Copy size={15} />
        </button>
      </div>
    ),
  },
];

const mockTransactions = [
  {
    id: 1,
    date: "7 Feb 2026 3:00PM",
    lender: "Aa11",
    txHash: "0xa8f7...",
    loanAmount: "$400",
    status: "Closed",
  },
  {
    id: 2,
    date: "7 Feb 2026 3:00PM",
    lender: "Aa11",
    txHash: "0xa8f7...",
    loanAmount: "$400",
    status: "Closed",
  },
  {
    id: 3,
    date: "7 Feb 2026 3:00PM",
    lender: "Aa11",
    txHash: "0xa8f7...",
    loanAmount: "$400",
    status: "Closed",
  },
];

const PAGE_SIZE = 3;

const RecentTransection = ({ transactions = mockTransactions }) => {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(transactions.length / PAGE_SIZE);
  const paged = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Card variant="simple" className="flex flex-col gap-5">
      <Typography variant="h4">Recent Transaction Activity</Typography>

      {/* Table */}
      <DataTable columns={columns} data={paged} transparent />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-2">
          <CustomPagination
            currentPage={page}
            totalPage={totalPages}
            setCurrentPage={setPage}
          />
        </div>
      )}
    </Card>
  );
};

export default RecentTransection;
