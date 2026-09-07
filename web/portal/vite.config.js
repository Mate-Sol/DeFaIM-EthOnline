import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    // defa_v2 lender-v2 pages use "@/..." imports throughout. Resolve "@"
    // to the lender-v2 root so those imports work without editing 80 files.
    // Colosseum-native code uses relative imports (./pages/…) so it's
    // unaffected by this alias.
    alias: {
      '@': path.resolve(__dirname, './src/lender-v2'),
    },
  },
  define: {
    // Some Solana wallet adapter deps reference `process.env.*`; vite doesn't
    // shim that by default. Empty stub keeps them from crashing at import.
    'process.env': {},
    global: 'globalThis',
  },
  optimizeDeps: {
    // Pre-bundle these; otherwise the wallet-adapter ESM/CJS interop blows
    // up at runtime in dev mode.
    include: [
      '@solana/web3.js',
      '@solana/wallet-adapter-base',
      '@solana/wallet-adapter-react',
      '@solana/wallet-adapter-react-ui',
      '@solana/wallet-adapter-wallets',
      'buffer',
    ],
  },
})
