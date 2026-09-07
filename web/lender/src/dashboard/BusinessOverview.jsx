import React from "react";
import Card from "../components/ui/Card";
import Typography from "../components/ui/Typography";
import { FileText } from "lucide-react";

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
    <span className="text-white/90 text-sm">{label}</span>
    <span className="text-white text-sm text-right max-w-[55%]">{value}</span>
  </div>
);

const BusinessOverview = ({
  established = "2019",
  industry = "Cross-border payments",
  focus = "SME trade finance",
  specialization = "USDC settlement operator",
  market = "UAE ↔ Pakistan · UAE ↔ South Africa corridors",
  about = "Licensed remittance & USDC settlement operator serving cross-border SMEs.",
  financials = {
    revenue: "$ 42.6M",
    netProfit: "$ 3.8M",
    equity: "$ 18.4M",
    debtToEquity: "0.42",
  },
  purposeOfFacility = [
    { left: "Prefunding", right: "Cross-border settlement" },
    { left: "Working Capital", right: "Corridor operations" },
    { left: "Financial Structuring", right: "Payment cycle bridging" },
  ],
  kyrReportUrl = null,
  kyrReportFilename = "KYR_Report.pdf",
  companyName = "About company",
}) => {
  return (
    <Card variant="simple" className="flex flex-col gap-6">
      <Typography variant="h5">Business Overview</Typography>

      {/* Info rows */}
      <div className="flex flex-col">
        <Row label="Established" value={established} />
        <Row label="Industry" value={industry} />
        <Row label="Focus" value={focus} />
        <Row label="Specialization" value={specialization} />
        <Row label="Market" value={market} />
      </div>

      {/* About */}
      <div>
        <Typography
          variant="caption"
          className="mb-1 block text-sm! text-white"
        >
          About 360Data
        </Typography>
        <Typography
          variant="body2"
          className="text-white/90 text-xs leading-relaxed"
        >
          {about}
        </Typography>
      </div>

      {/* Two-column section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Financial Strength */}
        <div>
          <Typography
            variant="caption"
            className="mb-3 block text-2xl! text-white!"
          >
            Financial Strength (USDC)
          </Typography>
          <div className="flex flex-col gap-1">
            <Row label="Revenue (ESGR)" value={financials.revenue} />
            <Row label="Net Profit (USDC)" value={financials.netProfit} />
            <Row label="Equity (USDC YTD)" value={financials.equity} />
            <Row label="Debt-to-Equity" value={financials.debtToEquity} />
          </div>
          {/* PDF Report — real anchor when a URL is supplied; muted
              placeholder otherwise so demos without a memo still render. */}
          {kyrReportUrl ? (
            <a
              href={kyrReportUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={kyrReportFilename}
              className="flex items-center gap-2 mt-3 p-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/40 w-fit transition-colors cursor-pointer group"
              title={`Download ${kyrReportFilename}`}
            >
              <FileText size={20} className="text-rose-400" />
              <span className="text-xs text-white font-medium">KYI Report</span>
              <span className="text-xs text-white/70 group-hover:text-white">View</span>
            </a>
          ) : (
            <div className="flex items-center gap-2 mt-3 p-2 rounded-xl bg-white/5 border border-white/10 w-fit opacity-60">
              <FileText size={20} className="text-rose-400" />
              <span className="text-xs text-white/60">KYI Report</span>
              <span className="text-xs text-white/30">Not yet uploaded</span>
            </div>
          )}
        </div>

        {/* Purpose of Facility */}
        <div>
          <Typography
            variant="caption"
            className="mb-3 block text-2xl! text-white!"
          >
            Purpose of Facility
          </Typography>
          <div className="flex flex-col gap-1">
            {purposeOfFacility.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
              >
                <span className="text-white text-xs">{item.left}</span>
                <span className="text-white text-xs">{item.right}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default BusinessOverview;
