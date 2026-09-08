FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
# npm install (not ci) — tolerant of lockfile drift across npm major versions.
RUN npm install --omit=dev --no-fund --no-audit

COPY . .

# The app reads PORT at runtime and defaults to 5050, which is what the
# existing Service targets. Do not set PORT here — overriding it silently
# breaks the cluster's port mapping.
EXPOSE 5050

CMD ["node", "index.js"]
