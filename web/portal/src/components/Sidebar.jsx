import { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  TrendingUp,
  FileText,
  UserPlus,
  Wallet,
  Users,
  FileCheck,
  AlertTriangle,
  LogOut,
  BarChart3,
  PieChart as PieChartIcon,
  DollarSign,
  Settings,
  ChevronDown,
  Bot,
  Zap,
} from "lucide-react";

const Sidebar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [statsOpen, setStatsOpen] = useState(false);

  const role = user?.role;
  const currentPath = location.pathname;

  // Check if any statistics sub-link is active (to auto-expand and highlight)
  const statisticsLinks = [
    {
      name: "Treasury Overview",
      path: "/admin/cfo",
      icon: <BarChart3 className="w-4 h-4" />,
    },
    {
      name: "Financing Requests",
      path: "/admin/super-admin",
      icon: <TrendingUp className="w-4 h-4" />,
    },
    {
      name: "Exposure Analysis",
      path: "/admin/cfo/exposure",
      icon: <PieChartIcon className="w-4 h-4" />,
    },
    {
      name: "Yield Reports",
      path: "/admin/cfo/yields",
      icon: <TrendingUp className="w-4 h-4" />,
    },
  ];

  const isStatActive = statisticsLinks.some((l) => currentPath === l.path);

  const getLinks = () => {
    if (role === "PSP") {
      return {
        main: [
          // { name: 'Agent Droog', path: '/ai-chat', icon: <Bot className="w-5 h-5" /> },
          { name: 'Dashboard', path: '/psp/dashboard', icon: <TrendingUp className="w-5 h-5" /> },
          { name: 'Borrow Portal', path: '/psp/borrow/facilities', icon: <DollarSign className="w-5 h-5" /> },
          user?.creditLineStatus == 'Approved' ? { name: 'Order Book', path: '/psp/order-book', icon: <FileText className="w-5 h-5" /> } : null,
          { name: 'Profile', path: '/psp/onboarding', icon: <UserPlus className="w-5 h-5" /> },
          { name: 'Agreement & Onboarding', path: '/psp/agrement-onboarding', icon: <FileText className="w-5 h-5" /> },

          {
            name: "Contact Us",
            path: "/customer-support",
            icon: <Users className="w-5 h-5" />,
          },
        ].filter(Boolean),
        hasStats: false,
      };
    }

    if (
      ["KAM", "CAD", "CRO", "VIEW_ONLY_ADMIN", "LEGAL_ADMIN", "CFO"].includes(
        role,
      )
    ) {
      let dashboardPath =
        role === "VIEW_ONLY_ADMIN"
          ? "/admin/super-admin"
          : `/admin/${role.toLowerCase()}`;
      if (role === "LEGAL_ADMIN") dashboardPath = "/admin/legal";
      const links = [
        {
          name: "Dashboard",
          path: dashboardPath,
          icon: <TrendingUp className="w-5 h-5" />,
        },
        {
          name: "PSP Management",
          path: "/admin/user-management",
          icon: <Users className="w-5 h-5" />,
        },
      ];

      if (role === "CAD") {
        links.push({
          name: "All Orderbooks",
          path: "/admin/cad/order-book",
          icon: <FileText className="w-5 h-5" />,
        });
        links.push({
          name: "Repayment Confirmation",
          path: "/admin/repayments_confirmation",
          icon: <DollarSign className="w-5 h-5" />,
        });
      }
      if (["CAD", "CRO", "VIEW_ONLY_ADMIN", "CFO"].includes(role)) {
        links.push({
          name: "Transactions",
          path: "/admin/repayments",
          icon: <DollarSign className="w-5 h-5" />,
        });
        if (role !== "CFO") {
          links.push({ name: 'Agent Droog', path: '/rag/projects', icon: <Bot className="w-5 h-5" /> });
        }
      }

      // Facility approval queue — KAM/CAD/CRO each see facilities awaiting
      // their step. CRO can edit terms before locking.
      if (["KAM", "CAD", "CRO"].includes(role)) {
        links.push({
          name: "Facility Queue",
          path: "/admin/facility-queue",
          icon: <Zap className="w-5 h-5" />,
        });
      }

      // Pool Init queue — facilities CRO has approved that still need an
      // on-chain admin to sign `initialize_pool`.
      if (["KAM", "CAD", "CRO", "CFO", "LEGAL_ADMIN"].includes(role)) {
        links.push({
          name: "Pool Initializations",
          path: "/admin/pool-inits",
          icon: <Zap className="w-5 h-5" />,
        });
      }

      // links.push({ name: 'Agent Droog', path: '/ai-chat', icon: <Bot className="w-5 h-5" /> });
      links.push({
        name: "Support",
        path: "/customer-support",
        icon: <Users className="w-5 h-5" />,
      });

      return { main: links, hasStats: true };
    }

    // if (role === 'CFO') {
    //   return {
    //     main: [
    //       { name: 'Transactions', path: '/admin/cfo/repayments', icon: <DollarSign className="w-5 h-5" /> },
    //       { name: 'Agent Droog', path: '/ai-chat', icon: <Bot className="w-5 h-5" /> },
    //       { name: 'Support', path: '/customer-support', icon: <Users className="w-5 h-5" /> },
    //     ],
    //     hasStats: true,
    //   };
    // }

    return { main: [], hasStats: false };
  };

  const { main: links, hasStats } = getLinks();

  return (
    <aside className="sidebar">
      <div className="p-6 border-b border-white/10">
        <div className="flex flex-col items-center gap-2">
          {/* Main Logo */}
          <img
            src="https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/693054518ad883eb5a10324c_defa_updated_logo.svg"
            alt="DeFa"
            className="h-8 w-auto"
            draggable={false}
          />
          <span className="text-[12px] text-white/40 text-center mt-3">
            The Liquidity Engine for Payment Service Providers
          </span>
        </div>
        {/* <div className="mt-5">
          <span className="text-xs text-white/60 block font-medium uppercase tracking-wider">
            {user?.role?.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] text-white/40 block">
            Digital Asset Financing
          </span>
        </div> */}
      </div>

      <nav className="p-4 space-y-1">
        {links.map((link) => (
          <Link
            key={link.path + link.name}
            to={link.path}
            className={`sidebar-link ${currentPath === link.path ? "active" : ""}`}
          >
            {link.icon}
            {link.name}
          </Link>
        ))}

        {/* Statistics Dropdown */}
        {hasStats && role !== 'KAM' && (
          <div>
            <button
              onClick={() => setStatsOpen(!statsOpen)}
              className={`sidebar-link w-full justify-between ${isStatActive ? "bg-white/10 text-white" : ""}`}
            >
              <span className="flex items-center gap-3">
                <BarChart3 className="w-5 h-5" />
                Statistics
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${statsOpen || isStatActive ? "rotate-180" : ""}`}
              />
            </button>

            <div
              className={`overflow-hidden transition-all duration-200 ${statsOpen || isStatActive ? "max-h-60 opacity-100" : "max-h-0 opacity-0"}`}
            >
              <div className="ml-4 pl-3 border-l border-white/10 mt-1 space-y-0.5">
                {statisticsLinks.map((link) => (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`sidebar-link text-sm py-2 ${currentPath === link.path ? "active" : ""}`}
                  >
                    {link.icon}
                    {link.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
      </nav>

      <div className="mt-auto p-4 border-t border-white/10">
        <div className="px-4 py-2 mb-2">
          <p className="text-xs text-white/60 truncate font-medium">
            {user?.name}
          </p>
          <p className="text-[10px] text-white/40 truncate">{user?.email}</p>
        </div>
        <Link
          to="/settings"
          className={`sidebar-link w-full justify-start mb-1 ${currentPath === "/settings" ? "active" : "text-white/60 hover:text-white"}`}
        >
          <Settings className="w-5 h-5" />
          Settings
        </Link>
        <button
          onClick={logout}
          className="sidebar-link w-full justify-start text-white/60 hover:text-white transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
