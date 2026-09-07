import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MOCK_POOLS } from "../Mock/mock_data";
import PoolInfoCard from "../components/ui/PoolInfoCard";
import DepositForm from "../dashboard/DepositForm";
import BusinessOverview from "../dashboard/BusinessOverview";
import PerformanceGraph from "../dashboard/PerformanceGraph";
import RecentTransection from "../dashboard/RecentTransection";
import TabBar from "../components/navigation/TabBar";
import Typography from "../components/ui/Typography";
import Chip from "../components/ui/Chip";
import Card from "../components/ui/Card";
import { TrendingUp, Wallet, BarChart2, PieChart } from "lucide-react";
import StateCard from "@/components/ui/StateCard";
import { getChainIcon, chainOptions } from "@/libs/utils/chainIcons";
import { axiosInstance } from "@/libs/axios";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";

const TABS = [
  { id: "my-position", label: "My Position" },
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "risk", label: "Risk" },
  { id: "activity", label: "Activity" },
];

const PoolDetails = () => {
  const userData = useSelector((state) => state.auth.user);
  const { dealId } = useParams();
  const [activeTab, setActiveTab] = useState("my-position");
  const [deal, setDeal] = useState(null);

  const sparkline = [40, 55, 45, 60, 50, 70, 65, 80, 75, 90];
  const barChart = [8, 12, 10, 18, 22, 28, 35, 45, 58, 70, 82, 92, 100];
  const lineChart = [80, 70, 75, 65, 70, 60, 55, 50, 45, 40];
  const donutChart = [60, 80, 70, 90, 85, 95, 88, 92, 78, 82];

  const chainInfo =
    chainOptions.find((c) => c?.key === deal?.chain) || chainOptions[0];

  const handleDealDetails = async () => {
    if (!dealId) return;
    try {
      const res = await axiosInstance.get(
        `/marketPlaces/getDealsById/${dealId}`,
      );
      const deal = res;
      // Check if current user has lended
      const isLendedByThisUser = deal?.poolLenders.find(
        (lender) => lender?.lenderId === userData?._id,
      );
      if (!deal?.poolAddress) {
        // If no pool exists yet, set defaults
        setDeal({
          ...deal,
          amountCollected: 0,
          isLendedByThisUser: !!isLendedByThisUser,
          poolMatureTime: 0,
          bufferTime: 0,
          poolEndTime: 0,
          isMatured: false,
          isBufferedDays: false,
          poolClosed: false,
          showEnableClaim: false,
          isEnableClaimBack: false,
          isSoftCapReached: false,
        });
      } else {
        // Update deal state
        setDeal({
          ...deal,
          isLendedByThisUser: !!isLendedByThisUser,
        });
      }
    } catch (error) {
      console.log("error", error);
      toast.error(error);
    }
  };
  useEffect(() => {
    handleDealDetails();
  }, [dealId, userData?._id]);

  return (
    <div className="flex flex-col gap-6 items-center justify-center p-22 sm:p-6  ">
      {/* Page Title */}
      <div className="flex flex-row items-center gap-3 -ml-220">
        <Typography variant="h3">Pools</Typography>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm">
          {getChainIcon(deal?.chain, 18)}
          <span className="text-white text-sm font-medium">
            {chainInfo.label}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
        </div>
      </div>

      {/* Main layout: left content + right deposit form */}
      <div className="flex flex-col xl:flex-row gap-6 max-w-6xl">
        {/* Left Column */}
        <div className="flex flex-col gap-6 flex-1 ">
          {/* Pool Info Card */}
          <PoolInfoCard
            daysLeft={deal?.status === "awaitingSignatures" ? 0 : deal?.remainingDays}
            ticketSize={deal?.totalLoan?.replace("$ ", "") || "95,000"}
            ticketSizeSub="72.32 USDC"
            totalDeposit="1,500.00"
            totalDepositSub="341.2 USDC"
            apyRate={deal?.apyRate || "13.00%"}
            apyRateSub="Annualized"
            tenure={deal?.loanTenure || "3.5 years"}
            tenureSub="42 months"
          />
          {/* bottom border line */}
          <div className="w-full h-0.5 bg-white/40 my-2" />

          {/* Tab Bar */}
          <TabBar
            tabs={TABS}
            defaultActive="my-position"
            onTabChange={setActiveTab}
            variant="underline"
          />

          {/* Tab Content */}
          {activeTab === "my-position" && (
            <div className="flex flex-col gap-6">
              {/* KPI mini cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <StateCard
                  icon={Wallet}
                  label="My Deposit"
                  value="$ 1,500.00"
                  chart={sparkline}
                  chartType="area"
                  chartOptions={{ stroke: { curve: "smooth" } }}
                />
                <StateCard
                  icon={TrendingUp}
                  label="Projected Earnings"
                  value="$ 48.75"
                  chart={barChart}
                  chartType="bar"
                  chartOptions={{
                    plotOptions: {
                      bar: { borderRadius: 3, columnWidth: "55%" },
                    },
                    colors: ["rgba(255,255,255,0.9)"],
                  }}
                />
                <StateCard
                  icon={BarChart2}
                  label="Total Proceeds"
                  value="$ 1,548.75"
                  chart={lineChart}
                  chartType="line"
                  chartOptions={{ markers: { size: 5, strokeColors: "#fff" } }}
                />
                <StateCard
                  icon={PieChart}
                  label="Realized Proceeds"
                  value="$ 1,548.5"
                  chart={donutChart}
                  chartType="donut"
                  chartOptions={{
                    plotOptions: { pie: { donut: { size: "70%" } } },
                  }}
                />
              </div>

              {/* Business Overview */}
              <BusinessOverview
                kyrReportUrl={deal?.kyrReport?.url}
                kyrReportFilename={deal?.kyrReport?.filename}
                companyName={deal?.business?.company || deal?.poolName}
                about={deal?.business?.description || undefined}
                industry={deal?.business?.sector || undefined}
                market={deal?.business?.jurisdiction || undefined}
              />

              {/* Performance Graph */}
              <PerformanceGraph />

              {/* Recent Transactions */}
              <RecentTransection />
            </div>
          )}

          {activeTab === "overview" && <BusinessOverview
                kyrReportUrl={deal?.kyrReport?.url}
                kyrReportFilename={deal?.kyrReport?.filename}
                companyName={deal?.business?.company || deal?.poolName}
                about={deal?.business?.description || undefined}
                industry={deal?.business?.sector || undefined}
                market={deal?.business?.jurisdiction || undefined}
              />}

          {activeTab === "performance" && <PerformanceGraph />}

          {activeTab === "activity" && <RecentTransection />}

          {activeTab === "risk" && (
            <Card variant="simple">
              <Typography variant="body1" className="text-white/50">
                Risk data coming soon.
              </Typography>
            </Card>
          )}
        </div>

        {/* Right Column — Deposit Form */}
        <div className="w-full  xl:w-80 shrink-0">
          <DepositForm walletBalance="99,000.00" currency="USDC" deal={deal} />
        </div>
      </div>
    </div>
  );
};

export default PoolDetails;
