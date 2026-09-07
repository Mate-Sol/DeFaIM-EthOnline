import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDisconnect } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { LogOut } from 'lucide-react';
import '../../styles/defa.css';

/**
 * On-chain admin shell layout. Top nav with wallet button + section tabs.
 * All children render inside the DeFa themed shell.
 *
 * Auth gate: if no JWT in sessionStorage, bounce to /onchain-admin/login.
 */
const OnChainAdminLayout = ({ children, requireAuth = true }) => {
  const navigate = useNavigate();
  const { disconnect } = useDisconnect();
  const [me, setMe] = useState(null);

  useEffect(() => {
    if (!requireAuth) return;
    const tok = sessionStorage.getItem('token');
    const u = sessionStorage.getItem('user');
    if (!tok) { navigate('/onchain-admin/login'); return; }
    let parsed = null;
    if (u) {
      try { parsed = JSON.parse(u); } catch {}
    }
    // Hard gate: this portal is reserved for ONCHAIN_ADMIN role. A lender
    // or PSP token must NOT be allowed to render admin pages — even though
    // on-chain program checks would still reject the wrong signer, we
    // refuse to expose the UI surface in the first place.
    if (!parsed || parsed.role !== 'ONCHAIN_ADMIN') {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      navigate('/onchain-admin/login');
      return;
    }
    setMe(parsed);
  }, [requireAuth]);

  const handleLogout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('lender');
    try { disconnect(); } catch {}
    navigate('/');
  };

  const tabs = [
    { to: '/onchain-admin/initialize',   label: 'Initialize Queue' },
    { to: '/onchain-admin/facilities',   label: 'Facilities' },
    { to: '/onchain-admin/access-codes', label: 'Access Codes' },
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
            On-Chain Admin · Testnet
          </div>
        </div>

        {requireAuth && (
          <nav className="hidden md:flex items-center gap-2">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `defa-pill ${isActive ? 'defa-pill-active' : ''}`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-3">
          <ConnectButton />
          {requireAuth && me && (
            <button onClick={handleLogout} className="defa-btn-ghost" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <main className="px-6 lg:px-12 pb-16">{children}</main>
    </div>
  );
};

export default OnChainAdminLayout;
