# Wir nutzen eine schlanke Node.js-Version als Basis
FROM node:20-alpine

# Arbeitsverzeichnis im Container festlegen
WORKDIR /app

# git wird von npm gebraucht, um das gemeinsame Paket suite-kit direkt von GitHub zu holen
# (siehe package.json) - node:20-alpine bringt es nicht mit.
RUN apk add --no-cache git

# Abhängigkeiten kopieren und installieren
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install
RUN npx prisma generate

# Restlichen Code kopieren und die App für den Produktivbetrieb bauen
COPY . .
RUN npm run build

# Port freigeben
EXPOSE 3005

# Beim Starten des Containers: Datenbank-Struktur sicherstellen und App starten
CMD ["sh", "-c", "npx prisma db push && node migrate-token-hashes.js && npm start"]