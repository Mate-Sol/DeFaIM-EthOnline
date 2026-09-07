import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDisconnect } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { LogOut } from 'lucide-react';
import '../../../styles/defa.css';

/**
 * PSP "borrow" shell — DeFa-themed, sibling to lender + on-chain admin
 * shells. Houses everything facility/drawdown-related. The PSP's existing
 * /psp/dashboard, /psp/order-book, /psp/onboarding etc. stay in the
 * legacy light theme; this section is just for the borrowing lifecycle.
 *
 * Auth: PSP JWT in sessionStorage (existing AuthContext). Wallet is EVM
 * (MetaMask / RainbowKit) — signs repay / drawdown-related transactions.
 */
const PspBorrowLayout = ({ children }) => {
  const navigate = useNavigate();
  const { disconnect } = useDisconnect();
  const [me, setMe] = useState(null);

  useEffect(() => {
    const tok = sessionStorage.getItem('token');
    const u = sessionStorage.getItem('user');
    if (!tok) { navigate('/login'); return; }
    if (u) { try { setMe(JSON.parse(u)); } catch {} }
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('lender');
    try { disconnect(); } catch {}
    navigate('/');
  };

  const tabs = [
    { to: '/psp/borrow/facilities', label: 'My Facilities' },
    { to: '/psp/dashboard',         label: 'Back to Portal', external: true },
  ];

  return (
    <div className="defa-shell">
      <header className="px-6 lg:px-12 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/693054518ad883eb5a10324c_defa_updated_logo.svg"
            alt="DeFa"
            className="h-9 w-auto"
            draggable={false}
          />
          <div className="text-[10px] uppercase tracking-widest text-white/60 leading-none">
            Borrower {me?.name ? `· ${me.name}` : ''}
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-2">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/psp/borrow/facilities'}
              className={({ isActive }) =>
                `defa-pill ${isActive && !t.external ? 'defa-pill-active' : ''}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <ConnectButton />
          <button onClick={handleLogout} className="defa-btn-ghost" title="Sign out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="px-6 lg:px-12 pb-16">{children}</main>
    </div>
  );
};

export default PspBorrowLayout;
