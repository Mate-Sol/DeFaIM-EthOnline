import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, KeyRound, Zap, Coins } from 'lucide-react';
import '../styles/defa.css';

// Real brand assets pulled from imdefa.com's CDN. Hotlinked so the landing
// matches the production marketing site without bundling the binaries.
const ASSETS = {
  logo:    'https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/693054518ad883eb5a10324c_defa_updated_logo.svg',
  hero:    'https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/69e8f2c0913eb4c3b1439f95_hero3.webp',
  ytSign:  'https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/69eb7febcb46dd812d85fac9_DeFa%20-%20%20YT%20thambnail.webp',
  coin:    'https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/69e903f56850832a0d8346d5_coin-img.webp',
  awards: {
    deloitte: 'https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/69159e90bf270200ec645200_deloiette.avif',
    inc:      'https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/69e874688cd5eca3d51fab31_BEST%20BLOCKCHAIN%20APP.webp',
    future:   'https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/6918477304ea93a1200bc0b4_future.avif',
  },
};

// Public landing. Three audiences, ranked by visibility:
//   1. PSP / Borrower    — primary CTA card, audience headline
//   2. Lender            — primary CTA card, audience headline
//   3. Admin / OnChain   — small isolated cluster, top-right of nav
//                          (internal users, not public marketing audience)
// Hero illustration is layered as a backdrop behind the top of the page
// (right-aligned). The page gradient sits below as the fallback color so
// content below the fold blends seamlessly. Below 1024px we drop the
// backdrop and the hero becomes a regular single-column layout.
const Landing = () => (
  <div className="defa-shell relative overflow-x-hidden">
    <div
      aria-hidden
      className="hidden lg:block absolute top-0 right-0 pointer-events-none"
      style={{
        width: '60%',
        height: '110vh',
        backgroundImage: `url(${ASSETS.hero})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right top',
        backgroundSize: 'cover',
        // Soften the left edge of the image so it bleeds into the rest of
        // the page gradient without a visible seam.
        WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 22%, black 100%)',
        maskImage:       'linear-gradient(to right, transparent 0%, black 22%, black 100%)',
        zIndex: 0,
      }}
    />
    <div className="relative" style={{ zIndex: 1 }}>
      <TopNav />
      <Hero />
      <AudienceSection />
      <TrustRow />
      <Footer />
    </div>
  </div>
);

const TopNav = () => (
  <header className="max-w-7xl mx-auto px-6 lg:px-10 pt-6 flex items-center justify-between">
    <Brand />
    <div className="flex items-center gap-2">
      {/* Internal sign-in — visually subordinated to the public CTAs */}
      <AdminCluster />
      <a href="#audiences" className="defa-pill" style={{ paddingTop: 10, paddingBottom: 10 }}>
        Get Started
      </a>
    </div>
  </header>
);

const Brand = () => (
  <Link to="/" className="flex items-center" aria-label="DeFa home">
    <img src={ASSETS.logo} alt="DeFa — Protocol by InvoiceMate" className="h-12 w-auto" />
  </Link>
);

// Hero text — image lives in the page backdrop now, so this column only
// occupies the left half on desktop. Capped width so headline doesn't
// crawl into the illustration on the right.
const Hero = () => (
  <section id="hero" className="max-w-7xl mx-auto px-6 lg:px-10 pt-16 lg:pt-24 pb-20">
    <div className="max-w-2xl lg:max-w-[640px]">
      <span className="defa-pill" style={{ cursor: 'default' }}>
        <span className="w-2 h-2 rounded-full bg-emerald-300" />
        Now live on-chain
      </span>
      <h1 className="defa-headline mt-6">
        On-Chain<br />Liquidity as<br />a Service <span className="text-white/85">(LaaS)</span><br />Infrastructure
      </h1>
      <p className="defa-subhead mt-6 max-w-xl">
        Turning receivables into high-velocity, secured yield. Programmatic credit facilities,
        verifiable on-chain — for borrowers and lenders alike.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link to="/apply-access" className="defa-btn-primary">
          Apply for Access <ArrowRight className="w-4 h-4" />
        </Link>
        <a href="#audiences" className="defa-btn-ghost">Choose your portal</a>
      </div>
    </div>
  </section>
);

// Two-card audience section — the actual sign-in entry points for the
// public audiences. Phrased as audience questions, not portal labels.
const AudienceSection = () => (
  <section id="audiences" className="max-w-7xl mx-auto px-6 lg:px-10 pt-2 pb-20">
    <div className="text-center mb-10">
      <div className="defa-label mb-2">Choose your path</div>
      <h2 className="text-2xl lg:text-3xl font-bold tracking-tight">Built for borrowers and lenders.</h2>
      <p className="text-white/70 text-sm mt-2 max-w-xl mx-auto">
        Pick the side you're on — the rest of the experience is tailored from there.
      </p>
    </div>

    <div className="grid md:grid-cols-2 gap-5 lg:gap-6">
      <AudienceCard
        eyebrow="For PSPs & Borrowers"
        icon={<Zap className="w-5 h-5" />}
        headline="Need liquidity on demand for instant settlement?"
        body="Get a CRO-approved credit facility, draw down stable USDC the same day, and repay on-chain. No banks, no delays, no manual reconciliation — just programmatic credit."
        bullets={['Drawdowns settle in seconds', 'Multiple facilities per PSP', 'Pay only for what you use']}
        cta="Open PSP Portal"
        href="/login"
      />

      <AudienceCard
        eyebrow="For Lenders"
        icon={<Coins className="w-5 h-5" />}
        headline="Looking for stable, secured yield from real receivables?"
        body="Deposit USDC into pre-vetted facilities and earn predictable yield from utilization and commitment fees. Your position is visible on-chain at every moment."
        bullets={['Yield from real-world receivables', 'On-chain transparency', 'Wallet-only sign-in, non-custodial']}
        cta="Open Lender Portal"
        href="/lender/login"
      />
    </div>
  </section>
);

const AudienceCard = ({ eyebrow, icon, headline, body, bullets, cta, href }) => (
  <Link to={href} className="defa-role-card" style={{ minHeight: 320, padding: '32px 30px', gap: 18 }}>
    <div className="flex items-center gap-3">
      <div className="icon-tile">{icon}</div>
      <div className="defa-label">{eyebrow}</div>
    </div>
    <h3 className="text-2xl font-bold tracking-tight leading-snug">{headline}</h3>
    <p className="text-white/80 text-sm leading-relaxed">{body}</p>
    <ul className="space-y-1.5 mt-1">
      {bullets.map((b) => (
        <li key={b} className="text-sm text-white/70 flex items-center gap-2">
          <span className="w-1 h-1 rounded-full bg-white/60" />{b}
        </li>
      ))}
    </ul>
    <div className="mt-auto pt-3">
      <span className="defa-btn-primary">
        {cta} <ArrowRight className="w-4 h-4" />
      </span>
    </div>
  </Link>
);

// Internal sign-in cluster — KAM/CAD/CRO/CFO and on-chain admin role.
// Lives in the top-right of the nav so internal users find it immediately
// without crowding the public CTAs.
const AdminCluster = () => (
  <div className="hidden md:flex flex-col items-end mr-2 leading-tight">
    <Link to="/login" className="text-xs text-white/75 hover:text-white inline-flex items-center gap-1">
      <ShieldCheck className="w-3.5 h-3.5" /> Admin sign-in
    </Link>
    <Link to="/onchain-admin/login" className="text-xs text-white/55 hover:text-white inline-flex items-center gap-1 mt-0.5">
      <KeyRound className="w-3 h-3" /> On-chain admin
    </Link>
  </div>
);

const TrustRow = () => (
  <section className="max-w-7xl mx-auto px-6 lg:px-10 pb-12">
    <div className="defa-divider mb-8" />
    <div className="flex flex-wrap items-center justify-center gap-x-14 gap-y-6 opacity-95">
      <img src={ASSETS.awards.deloitte} alt="Deloitte Rising Star Winner" className="h-12 w-auto" />
      <img src={ASSETS.awards.inc}      alt="Inc. — Best Blockchain App"  className="h-12 w-auto" />
      <img src={ASSETS.awards.future}   alt="Future 100"                  className="h-12 w-auto" />
    </div>
  </section>
);

const Footer = () => (
  <footer className="max-w-7xl mx-auto px-6 lg:px-10 pb-10 text-xs text-white/55">
    <div className="defa-divider mb-6" />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>© {new Date().getFullYear()} DeFa Protocol — Liquidity as a Service.</div>
      <div className="flex items-center gap-4">
        <a href="#" className="hover:text-white">Privacy</a>
        <a href="#" className="hover:text-white">Terms</a>
        <a href="https://invoicemate.net" target="_blank" rel="noreferrer" className="hover:text-white">InvoiceMate</a>
      </div>
    </div>
  </footer>
);

export default Landing;
