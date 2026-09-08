# External PSP portal — Vite static build served by nginx.
#
# VITE_* are baked in at BUILD time from .env.production (committed; public
# values only), matching the lender and portal images.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --no-fund --no-audit

COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

# ── nginx stage ──────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html

# SPA fallback so react-router handles unknown routes.
RUN echo 'server { \
  listen 8082; \
  server_name _; \
  root /usr/share/nginx/html; \
  index index.html; \
  location / { try_files $uri $uri/ /index.html; } \
  location ~* \\.(css|js|svg|png|jpg|jpeg|webp|ico)$ { \
    expires 30d; add_header Cache-Control "public"; \
  } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 8082
CMD ["nginx", "-g", "daemon off;"]
