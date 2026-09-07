# PayMate PSP + admin (legacy) client — Vite static build served by nginx.
# Multi-stage: build the bundle in-image (no committed dist/ needed), then
# serve it with nginx. All VITE_* must be present at BUILD time (Vite bakes
# them into the static bundle).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# npm install (not ci) — tolerant of lockfile drift across npm major versions
# (the runner's node:20-alpine ships npm 10; locks may be generated with 11).
# --ignore-scripts skips native-module compiles (usb/node-hid/keccak, pulled in
# by wallet libs) that need Python + a C toolchain absent from alpine. Those are
# Node-only hardware-wallet transports, unused in the browser bundle. esbuild's
# Linux binary still resolves via its @esbuild/linux-x64 optional package.
RUN npm install --no-fund --no-audit --ignore-scripts

COPY . .

# Vite build-time env (baked into the static bundle). Provided via
# docker-compose build args or CI --build-arg.
# Vite bakes VITE_* env at build time. Values live in .env.production
# (committed to the repo — all public: onchain addrs, RPC, API URL).
# We deliberately do NOT expose ARG/ENV mappings for VITE_* here — an
# empty ARG becomes an empty ENV, which then overrides .env.production
# because Vite's process.env has higher priority than dotenv files.

# Base path for serving under /admin behind the ingress. Defaults to '/'
# so nothing breaks if built standalone; CI passes --build-arg VITE_BASE=/admin/.
ARG VITE_BASE=/
# The wallet-SDK dependency graph (metamask-sdk, reown/appkit, walletconnect,
# coinbase) exhausts Node's default heap during Rollup bundling — raise it.
ENV NODE_OPTIONS=--max-old-space-size=6144
RUN npm run build -- --base=${VITE_BASE}

# ── nginx stage ──────────────────────────────────────────────
FROM nginx:1.25.1

# React Router needs the SPA fallback (serve index.html for unknown routes).
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/conf.d
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
