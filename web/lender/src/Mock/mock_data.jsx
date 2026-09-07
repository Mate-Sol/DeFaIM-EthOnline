import {
  BriefcaseBusiness,
  Calendar,
  CheckCircle,
  DollarSign,
  HandCoins,
  TrendingUp,
  Wallet,
  WalletMinimal,
} from "lucide-react";
import { getChainIcon, chainOptions } from "@/libs/utils/chainIcons";

// --- ProgressBar ---
const ProgressBar = ({ value = 60 }) => (
  <div className="w-20 h-1.5 rounded-full bg-white/20 overflow-hidden">
    <div
      className="h-full rounded-full bg-white/60"
      style={{ width: `${value}%` }}
    />
  </div>
);
// --- Base columns ---
export const BASE_COLUMNS = [
  { key: "investment", label: "Investment Amount", infoText: "Total amount you have invested in this pool", render: (_, v) => `$ ${v}` },
  { key: "apy", label: "APY Rate", infoText: "Annual Percentage Yield — your expected yearly return" },
  { key: "riskType", label: "Risk Type", infoText: "Risk classification of the pool (Low / Medium / High)" },
  {
    key: "chain",
    label: "Chain",
    infoText: "Blockchain network this pool runs on",
    render: (row) => {
      const chain = chainOptions.find((c) => c.key === row.chain);
      return (
        <span className="inline-flex items-center gap-2">
          {getChainIcon(row.chain, 16)}
          <span>{chain?.label ?? row.chain}</span>
        </span>
      );
    },
  },
  {
    key: "tenure",
    label: "Pool Tenure",
    infoText: "Duration of the pool and current progress",
    render: (row) => (
      <div className="flex items-center gap-2">
        <span>{row.tenure}</span>
        <ProgressBar value={row.tenureProgress} />
      </div>
    ),
  },
  {
    key: "status",
    label: "Status",
    infoText: "Current status of your loan in this pool",
    render: (_, v) => (
      <span className="px-4 py-1.5 rounded-full text-sm font-medium border border-white/20 bg-alert backdrop-blur-sm">
        {v}
      </span>
    ),
  },
];

// --- Available column options ---
export const COLUMN_OPTIONS = [
  {
    key: "totalLoanAmount",
    label: "Total Loan Amount",
    column: {
      key: "totalLoanAmount",
      label: "Total Loan Amount",
      render: (_, v) => (v ? `$ ${v}` : "—"),
    },
  },
  {
    key: "myLoanAmount",
    label: "My Loan Amount",
    column: {
      key: "myLoanAmount",
      label: "My Loan Amount",
      render: (_, v) => (v ? `$ ${v}` : "—"),
    },
  },
  {
    key: "myProfit",
    label: "My Profit",
    column: {
      key: "myProfit",
      label: "My Profit",
      render: (_, v) => (v ? `$ ${v}` : "—"),
    },
  },
  {
    key: "remainingProceeds",
    label: "Remaining Proceeds",
    column: {
      key: "remainingProceeds",
      label: "Remaining Proceeds",
      render: (_, v) => (v ? `$ ${v}` : "—"),
    },
  },
  {
    key: "startDate",
    label: "Start Date",
    column: { key: "startDate", label: "Start Date" },
  },
  {
    key: "completionDate",
    label: "Completion Date",
    column: { key: "completionDate", label: "Completion Date" },
  },
  {
    key: "actions",
    label: "Actions",
    column: {
      key: "actions",
      label: "Actions",
      render: () => (
        <button className="px-3 py-1 rounded-full text-xs border border-white/20 text-white/70 hover:text-white hover:bg-white/10 transition-colors">
          View
        </button>
      ),
    },
  },
];

// Loans preview rows for /wellcome + /loans. Hackathon build: only
// polygon chain rendered (chain key drives the icon+label via chainIcons).
// If we later wire the LoanPage to real API data, delete this array and
// have LoanPage fetch its own rows.
export const loansData = [
  {
    investment: "10,000",
    apy: "12%",
    riskType: "Medium Risk Pool",
    chain: "arc",
    tenure: "30 days",
    tenureProgress: 40,
    status: "Active",
    poolName: "Wise Pay Partners",
  },
  {
    investment: "5,000",
    apy: "6%",
    riskType: "Low Risk Pool",
    chain: "arc",
    tenure: "45 days",
    tenureProgress: 10,
    status: "Funding",
    poolName: "EFI Remitt",
  },
  {
    investment: "25,000",
    apy: "14%",
    riskType: "Medium Risk Pool",
    chain: "arc",
    tenure: "90 days",
    tenureProgress: 65,
    status: "Active",
    poolName: "TransferGo Capital",
  },
  {
    investment: "10,000",
    apy: "10%",
    riskType: "Medium Risk Pool",
    chain: "arc",
    tenure: "30 days",
    tenureProgress: 85,
    status: "Active",
    poolName: "Skrill Cross-Border",
  },
];

// ========Wallet's Data===============
// --- Base wallet cards ---
export const BASE_WALLET_CARDS = [
  {
    key: "walletBalance",
    label: "Wallet Balance",
    balance: "99,000.00",
    icon: <Wallet size={40} />,
  },
  {
    key: "myPortfolio",
    label: "My Portfolio",
    balance: "1,000.00",
    icon: <BriefcaseBusiness size={40} />,
  },
  {
    key: "remainingPayments",
    label: "Remaining Payments",
    balance: "9.000.00",
    icon: <HandCoins size={40} />,
  },
];
// --- Available wallet card options ---
export const WALLET_CARD_OPTIONS = [
  {
    key: "totalLoan",
    label: "Total Loan Amount",
    balance: "500,000",
    icon: <DollarSign size={40} />,
  },
  {
    key: "myLoanAmount",
    label: "My Loan Amount",
    balance: "100,000",
    icon: <WalletMinimal size={40} />,
  },
  {
    key: "myProfit",
    label: "My Profit",
    balance: "5,000",
    icon: <TrendingUp size={40} />,
  },
  {
    key: "remainingProceeds",
    label: "Remaining Proceeds",
    balance: "95,000",
    icon: <HandCoins size={40} />,
  },
  {
    key: "startDate",
    label: "Start Date",
    date: "01/01/2025",
    icon: <Calendar size={40} />,
  },
  {
    key: "completionDate",
    label: "Completion Date",
    date: "01/01/2026",
    icon: <CheckCircle size={40} />,
  },
];
// ========Wallet's Data===============

// dummy pool data
export const MOCK_POOLS = [
  {
    id: 1,
   chain: "arc",
    status: "Open",
    poolName: "Pool Name....",
    date: "07 April 2025",
    riskLevel: "Low Risk Pool",
    riskVariant: "low",
    riskValue: "low",
    apyRate: "13%",
    totalLoan: "$ 39,824",
    kyiScore: "61",
    loanTenure: "90 Days",
    myInvestments: "$ 1,000.00",
    myProfit: "$ 0.00",
    executionDate: "Feb 23, 2026",
    completion: "May 24, 2026",
    progressAmount: "$ 3,000.00",
    progressTotal: "$ 39,482.62",
    progressPercent: 8,
    totalLenders: 2,
    matured: "No",
  },
  {
    id: 2,
    chain: "arc",
    status: "Open",
    poolName: "Pool Name....",
    date: "07 April 2025",
    riskLevel: "Low Risk Pool",
    riskVariant: "low",
    riskValue: "low",
    apyRate: "13%",
    totalLoan: "$ 39,824",
    kyiScore: "61",
    loanTenure: "90 Days",
    myInvestments: "$ 1,000.00",
    myProfit: "$ 0.00",
    executionDate: "Feb 23, 2026",
    completion: "May 24, 2026",
    progressAmount: "$ 3,000.00",
    progressTotal: "$ 39,482.62",
    progressPercent: 8,
    totalLenders: 2,
    matured: "No",
  },
  {
    id: 3,
    chain: "arc",
    status: "Active",
    poolName: "Pool Name....",
    date: "07 April 2025",
    riskLevel: "Medium Risk Pool",
    riskVariant: "medium",
    riskValue: "medium",
    apyRate: "16%",
    totalLoan: "$ 55,000",
    kyiScore: "72",
    loanTenure: "60 Days",
    myInvestments: "$ 2,500.00",
    myProfit: "$ 120.00",
    executionDate: "Jan 10, 2026",
    completion: "Mar 10, 2026",
    progressAmount: "$ 10,000.00",
    progressTotal: "$ 55,000.00",
    progressPercent: 18,
    totalLenders: 5,
    matured: "No",
  },
  {
    id: 4,
    chain: "arc",
    status: "Settled",
    poolName: "Pool Name....",
    date: "07 April 2025",
    riskLevel: "High Risk Pool",
    riskVariant: "high",
    riskValue: "high",
    apyRate: "20%",
    totalLoan: "$ 80,000",
    kyiScore: "85",
    loanTenure: "30 Days",
    myInvestments: "$ 5,000.00",
    myProfit: "$ 800.00",
    executionDate: "Dec 01, 2025",
    completion: "Jan 01, 2026",
    progressAmount: "$ 80,000.00",
    progressTotal: "$ 80,000.00",
    progressPercent: 100,
    totalLenders: 8,
    matured: "Yes",
  },
];
