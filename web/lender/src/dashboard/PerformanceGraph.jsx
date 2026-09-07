import React, { useState, useRef, useEffect } from "react";
import Card from "../components/ui/Card";
import Typography from "../components/ui/Typography";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChevronDown } from "lucide-react";
import { DROPDOWN_PANEL_CLASS, DROPDOWN_ITEM_CLASS } from "../components/navigation/PlusDropdown";

// Full 12-month base dataset
const allData = [
  { date: "Jan", value: 50000 },
  { date: "Feb", value: 55000 },
  { date: "Mar", value: 60000 },
  { date: "Apr", value: 65000 },
  { date: "May", value: 70000 },
  { date: "Jun", value: 75000 },
  { date: "Jul", value: 80000 },
  { date: "Aug", value: 85000 },
  { date: "Sep", value: 88000 },
  { date: "Oct", value: 90000 },
  { date: "Nov", value: 92000 },
  { date: "Dec", value: 95000 },
];

const sliceMap = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };

const getChartData = (period) => allData.slice(-sliceMap[period]);

const timeOptions = [
  { label: "1m", value: "1m" },
  { label: "3m", value: "3m" },
  { label: "6m", value: "6m" },
  { label: "1y", value: "1y" },
];

const FilterPill = ({ label, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white text-xs whitespace-nowrap">{label}</span>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((p) => !p)}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-white text-xs hover:bg-white/20 transition-all"
        >
          {value}
          <ChevronDown size={12} />
        </button>
        {open && (
          <div className={`${DROPDOWN_PANEL_CLASS} right-0 mt-1 min-w-[72px]`}>
            {timeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`${DROPDOWN_ITEM_CLASS} px-4 py-1.5 ${value === opt.value ? "bg-white/15" : ""}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Chart color — keep in sync with --color-chart in globals.css
const CHART_COLOR = "#3b82f6";

const PerformanceGraph = ({ data }) => {
  const [filters, setFilters] = useState({
    "Pool Creation Date": "1m",
    "Pool Execution Date": "1m",
    "Pool End Date": "1m",
  });
  const [activePeriod, setActivePeriod] = useState("1m");

  const handleChange = (key, val) => {
    setFilters((prev) => ({ ...prev, [key]: val }));
    setActivePeriod(val);
  };

  const chartData = data ?? getChartData(activePeriod);

  return (
    <Card variant="simple" className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Typography variant="h5">Performance</Typography>
        <div className="flex items-center gap-3 flex-wrap">
          {Object.keys(filters).map((key) => (
            <FilterPill
              key={key}
              label={key}
              value={filters[key]}
              onChange={(val) => handleChange(key, val)}
            />
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <defs>
              <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLOR} stopOpacity={0.5} />
                <stop offset="95%" stopColor={CHART_COLOR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(15,23,42,0.85)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
                color: "#fff",
                fontSize: 12,
              }}
              formatter={(v) => [`$${v.toLocaleString()}`, "Value"]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={CHART_COLOR}
              strokeWidth={2}
              fill="url(#perfGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};

export default PerformanceGraph;
