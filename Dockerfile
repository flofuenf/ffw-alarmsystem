# --- Build-Stage: Abhaengigkeiten installieren und Frontend bauen ---
FROM node:22-slim AS build
WORKDIR /app

# Nur Manifeste zuerst -> bessere Layer-Caching
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm install

# Quellcode kopieren und Frontend bauen
COPY . .
# Google-Maps-Key wird beim Build ins Frontend eingebacken (optional)
ARG VITE_GOOGLE_MAPS_API_KEY=""
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
RUN npm run build

# --- Runtime-Stage: nur das Noetige zum Starten ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Abhaengigkeiten, Server und gebautes Frontend uebernehmen
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/package.json ./package.json

# Daten landen hier (als Volume mounten, damit sie Neustarts ueberleben)
VOLUME ["/app/server/data"]

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/api/state').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
