# DeFa Client — Frontend

Vite + React + Tailwind + Solana Wallet Adapter. Hosts five portals plus the public landing.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

`VITE_API_URL` defaults to `http://localhost:5050`.

---

## Portal map

| Route prefix | Portal | Auth | Where the code lives |
|---|---|---|---|
| `/` | Public landing | none | `pages/Landing.jsx` |
| `/apply-access` | Lender access-code redemption | wallet sig | `pages/ApplyAccess.jsx` |
| `/login` | PSP / Admin sign-in | email + password | `pages/Login.jsx` |
| `/lender/*` | Lender portal | wallet (`localStorage`) | `pages/lender/` |
| `/onchain-admin/*` | On-chain signing admin | wallet allow-listed in env | `pages/onchain-admin/` |
| `/psp/borrow/*` | PSP borrow portal (DeFa-themed) | PSP JWT (`sessionStorage`) | `pages/psp/borrow/` |
| `/psp/*` | PSP onboarding + dashboard (light theme) | PSP JWT | `pages/psp/` |
| `/admin/*` | KAM / CAD / CRO / CFO / Legal admin | role-gated JWT | `pages/admin/` |

---

## Key components

- **`components/defa/`** — DeFa-themed pieces shared across the on-chain portals: `FacilityCard`, `Pagination`, `NextActionsHero`, `QuickRequestModal`, `RequestFacilityModal`.
- **`components/admin/PoolInitConfirmModal.jsx`** — the override form on-chain admin sees before signing `initialize_pool`. Includes the test-mode `seconds_per_day` toggle.
- **`pages/onchain-admin/FacilityDetail.jsx`** — facility detail page. Houses the live `FacilityClock` widget that counts down to the next on-chain day boundary.
- **`pages/onchain-admin/AccessCodes.jsx`** — mint, list, and revoke lender access codes.
- **`services/solana.js`** — wallet helpers (`walletLogin`, `walletBind`, `signAndRelay`, `buildSignRelay`). Reads JWT from the right storage based on path (lender → `localStorage`, others → `sessionStorage`).
- **`utils/dateFmt.js`** — date helpers; `fmtWarpDayLabel` + `fmtCountdown` are the warp-aware variants.

---

## Theming

Cobalt blue gradient + frosted glass cards. Stylesheet at `styles/defa.css`. Tailwind utility classes everywhere else.

The DeFa logo is hot-linked from the marketing CDN (single `ASSETS.logo` constant in `Landing.jsx`) so we don't bundle binaries.

---

## Local dev tips

- The lender token lives in `localStorage`; PSP/admin token in `sessionStorage`. The path-aware `getToken()` in `services/solana.js` picks the right one. If you see "JWT errors" after switching between portals in the same tab, clear both.
- `/apply-access` shows an "already signed in" banner if a lender token is found — use it to jump straight to the dashboard during testing.
- For warp-time facility testing, request a facility with "Test mode" → day length `300` → admin signs `initialize_pool`. The `FacilityClock` on the on-chain admin facility detail page will tick down a full day every 5 minutes.
