import { NavLink } from "react-router-dom";
import { APP_NAME } from "../../libs/constants/appConfig";

const navItems = [
  { to: "/", label: "Overview" },
  { to: "/markets", label: "Markets" },
  { to: "/portfolio", label: "Portfolio" },
];

export function MainNav() {
  return (
    <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <p className="text-lg font-semibold tracking-wide">{APP_NAME}</p>
        <nav className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-emerald-500 text-slate-950"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
