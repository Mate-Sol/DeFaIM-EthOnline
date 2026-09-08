FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
# npm install (not ci) — tolerant of lockfile drift across npm major versions.
RUN npm install --omit=dev --no-fund --no-audit

COPY . .

# The app reads PORT at runtime and defaults to 5050; the deployment sets it.
ENV PORT=5090
EXPOSE 5090

CMD ["node", "index.js"]
