import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
// New EVM wallet stack — wagmi + RainbowKit + @tanstack/react-query.
// Every retargeted PSP/admin/onchain-admin page uses this.
import EvmWalletProvider from './context/EvmWalletProvider.jsx'

// Sentry — only initialised when VITE_SENTRY_DSN is set so dev builds
// stay quiet. Browser tracer + replay are skipped to keep the bundle
// small; we just want unhandled-error capture for the beta.
if (import.meta.env.VITE_SENTRY_DSN) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  import('@sentry/react').then(({ init }) => {
    init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.VITE_SENTRY_ENV || 'devnet-beta',
      tracesSampleRate: 0,
    })
  })
}


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <EvmWalletProvider>
        <App />
    </EvmWalletProvider>
  </StrictMode>,
)
