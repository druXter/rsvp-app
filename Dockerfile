# Wir nutzen eine schlanke Node.js-Version als Basis (aktuelle LTS, wie alle Tools der Suite)
FROM node:22-alpine

# git wird von npm gebraucht, um das gemeinsame Paket suite-kit direkt von GitHub zu holen
# (siehe package.json) - node:22-alpine bringt es nicht mit.
RUN apk add --no-cache git

# Arbeitsverzeichnis anlegen und dem unprivilegierten Nutzer "node" (UID 1000) übergeben.
# Installation, Build und Betrieb laufen bewusst NICHT als root: Eine Lücke in der App oder
# einer Abhängigkeit hätte sonst Root-Rechte im Container. Wie in den anderen Tools der Suite.
WORKDIR /app
RUN chown node:node /app
USER node

# Abhängigkeiten exakt nach package-lock.json installieren (npm ci statt npm install:
# reproduzierbar, bricht ab statt still andere Versionen zu ziehen)
COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma/
RUN npm ci
RUN npx prisma generate

# Restlichen Code kopieren und die App für den Produktivbetrieb bauen
COPY --chown=node:node . .
RUN npm run build

# next start lauscht standardmäßig auf Port 3000 im Container (außen 3005, siehe docker-compose.yml)
EXPOSE 3000

# Beim Starten des Containers: Datenbank-Struktur sicherstellen, einmalige Datenmigrationen (je über
# PRAGMA user_version geschützt) und App starten. --skip-generate: Der Client ist schon beim Build erzeugt.
CMD ["sh", "-c", "node migrate-drop-seating-columns.js && npx prisma db push --skip-generate && node migrate-token-hashes.js && node migrate-tool-links.js && node migrate-persons.js && node migrate-person-details.js && node migrate-invitation-reminders.js && npm start"]
