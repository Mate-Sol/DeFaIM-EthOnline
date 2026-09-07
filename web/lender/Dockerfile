# DeFa v2 lender client — Vite static build served by nginx
# Build args:
#   VITE_API_URL, VITE_CHAIN_ID, VITE_CHAIN_NAME, VITE_RPC_URL, VITE_*_ADDRESS
# All VITE_* need to be present at BUILD time (Vite bakes them in).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# npm install (not ci) — tolerant of lockfile drift across npm major versions
# (the runner's node:20-alpine ships npm 10; locks may be generated with 11).
RUN npm install --no-fund --no-audit

COPY . .

# .env variables are needed at build for Vite. If provided via docker-compose
# they'll be baked into the static bundle.
# Vite bakes VITE_* env at build time. Values live in .env.production
# (committed to the repo — all public: onchain addrs, RPC, API URL).
# We deliberately do NOT expose ARG/ENV mappings for VITE_* here — an
# empty ARG becomes an empty ENV, which then overrides .env.production
# because Vite's process.env has higher priority than dotenv files.
ENV NODE_OPTIONS=--max-old-space-size=4096

RUN npm run build

# ── nginx stage ──────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html

# SPA fallback — every unknown route serves index.html so react-router
# picks it up.
RUN echo 'server { \
  listen 8081; \
  server_name _; \
  root /usr/share/nginx/html; \
  index index.html; \
  location / { try_files $uri $uri/ /index.html; } \
  location ~* \\.(css|js|svg|png|jpg|jpeg|webp|ico)$ { \
    expires 30d; add_header Cache-Control "public"; \
  } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 8081
CMD ["nginx", "-g", "daemon off;"]
