import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import PoolWideCard from "@/dashboard/PoolWideCard";
import Chip from "../components/ui/Chip";
import { useNavigate } from "react-router-dom";
import { getChainIcon } from "@/libs/utils/chainIcons";
import { axiosInstance } from "@/libs/axios";
import CustomPagination from "@/components/navigation/CustomPagination";
import { toast } from "react-toastify";
import { MOCK_POOLS } from "@/Mock/mock_data";

const STATUS_TABS = ["All", "Open", "Active", "Settled"];

const RISK_FILTERS = [
  { label: "Low Risk", variant: "low", value: "Low" },
  { label: "Medium Risk", variant: "medium", value: "Medium" },
  { label: "High Risk", variant: "high", value: "High" },
];

const PoolList = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("All");
  const [activeRisk, setActiveRisk] = useState("All");
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 6;

  const selectedChain = useSelector((s) => s.chain.selected);
  console.log("🚀 ~ PoolList ~ selectedChain:", selectedChain);
  const userData = useSelector((s) => s.auth.user);

  const handleDealList = async (page = 1) => {
    try {
      setPosts([]);
      setPostsLoading(true);

      const response = await axiosInstance.post(
        `/marketPlaces/getAlldealsnew?sortingOrder=latest&search=&status=${activeTab}&blockChainType=${selectedChain?.label}&page=${page}&limit=${itemsPerPage}&riskType=${activeRisk}`,
        {
          id: userData?._id,
          role: userData?.role ? userData?.role : 2,
        },
      );

      if (response?.pagination) {
        setTotalPages(Math.ceil(response?.pagination?.totalPages));
        setPosts(response?.data || []);
      } else {
        setPosts(response || []);
      }
    } catch (error) {
      console.log("🚀 ~ handleDealList ~ error:", error);
      // ── LOCAL DEV VIEWING FALLBACK (reference clone only — never ship) ──
      if (import.meta.env.VITE_AUTH_BYPASS === "1") {
        setPosts(MOCK_POOLS);
        setTotalPages(1);
      } else {
        toast.error(error?.message);
      }
    } finally {
      setPostsLoading(false);
    }
  };

  const handlePageChange = (page) => {
    try {
      setCurrentPage(page);
      handleDealList(page);
    } catch (error) {
      console.log("🚀 ~ handlePageChange ~ error:", error);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    handleDealList(1);
  }, [activeTab, activeRisk, selectedChain]);

  return (
    <>
      <section className="px-4 py-6 sm:px-6 sm:py-8 md:px-10 md:py-10 space-y-6 sm:space-y-8 max-w-7xl mx-auto">
        {/* ── Page Header ── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          {/* Title + chain badge (Figma style) */}
          <div className="flex items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Pools
            </h1>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm">
              {getChainIcon(selectedChain.key, 18)}
              <span className="text-white text-sm font-medium">
                {selectedChain.label}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
            </div>
          </div>

          {/* Risk Level Filters */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-row items-center gap-4 justify-end">
              <span className="text-white/90 text-xs sm:text-sm font-medium">
                Risk Level:
              </span>
              <Chip
                variant="low"
                dot={false}
                className="px-3! py-1! text-xs! cursor-default"
              >
                Expired
              </Chip>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap lg:-mb-26">
              {RISK_FILTERS.map(({ label, variant, value }) => (
                <button
                  key={value}
                  onClick={() =>
                    setActiveRisk(activeRisk === value ? null : value)
                  }
                  className="focus:outline-none"
                >
                  <Chip
                    variant={variant}
                    className={`px-3! py-1! text-xs! transition-all duration-200 ${
                      activeRisk === value
                        ? "ring-2 ring-white/50 scale-105"
                        : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    {label}
                  </Chip>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Status Tab Bar ── */}
        <div className="overflow-x-auto no-scrollbar">
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-full p-1 inline-flex gap-1 min-w-max">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 sm:px-6 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab
                    ? "bg-white/20 text-white shadow-sm border border-white/20"
                    : "text-white/50 hover:text-white hover:bg-white/10"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>


        {postsLoading ? (
        <div className="text-center col-span-2 py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-white border-r-transparent"></div>
          <p className="mt-4">Loading pools...</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center col-span-2 py-12">
          <p>No pools found</p>
        </div>
      ) : null}

        {/* ── Pool Grid ── */}
        {posts?.length > 0 ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
              {posts?.map((pool) => (
                <PoolWideCard
                  key={pool?.id}
                  // {...pool}
                  deal={pool}
                  onClick={(dealId) => navigate(`/pool/${dealId}`)}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <CustomPagination
                currentPage={currentPage}
                totalPage={totalPages}
                setCurrentPage={handlePageChange}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 sm:py-24 gap-3">
            <span className="text-white/20 text-4xl sm:text-5xl">⬡</span>
            <p className="text-white/40 text-sm">
              No pools match the selected filters.
            </p>
          </div>
        )}
      </section>
    </>
  );
};

export default PoolList;
