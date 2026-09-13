FROM node:22-alpine

WORKDIR /app

# Build context is the repo root so that agent/ can be copied in; every path
# below is therefore repo-relative.
COPY server/package*.json ./
# npm install (not ci) — tolerant of lockfile drift across npm major versions.
RUN npm install --omit=dev --no-fund --no-audit

COPY server/ ./
# The risk-findings route evaluates the same rules the standalone monitor
# does, so the image carries agent/ rather than duplicating them. Kept at the
# path the route expects: /agent, resolved as ../../agent from /app/routes.
COPY agent/ /agent/

# The app reads PORT at runtime and defaults to 5050, which is what the
# existing Service targets. Do not set PORT here — overriding it silently
# breaks the cluster's port mapping.
EXPOSE 5050

CMD ["node", "index.js"]
