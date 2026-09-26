# CityMasters — Backend

Backend Node.js/Express réel pour CityMasters : authentification par compte,
packs, calcul de maire, enchères, abonnement Premium via Stripe. Toute la
logique de jeu tourne ici, côté serveur — le client ne peut plus rien
falsifier (contrairement au prototype précédent qui tournait entièrement
dans le navigateur).

## Stack

- **Node.js + Express** — API REST
- **SQLite** (`better-sqlite3`) — base de données fichier, zéro configuration.
  Suffisant pour démarrer ; migrer vers PostgreSQL quand le trafic grossit
  (Railway et Render fournissent une base Postgres managée en un clic).
- **JWT** — authentification par jeton (pas de sessions serveur à gérer)
- **Stripe** — abonnement Premium récurrent

## Installation locale

```bash
npm install
cp .env.example .env
# Remplis .env avec tes vraies clés (voir section Stripe ci-dessous)
npm start
```

Le serveur écoute sur `http://localhost:3000`. Teste avec :

```bash
curl http://localhost:3000/health
# {"ok":true}

curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"toi@example.com","password":"motdepasse123","username":"toi"}'
# {"token":"..."}
```

Utilise ensuite ce token dans l'en-tête `Authorization: Bearer <token>` pour
tous les appels à `/game/*` et `/market/*`.

## Configurer Stripe (abonnement Premium)

1. Crée un compte sur https://dashboard.stripe.com si ce n'est pas déjà fait.
2. Dans **Produits**, crée un produit "CityMasters Premium" avec un prix
   récurrent mensuel (ex: 6,99 €). Copie l'ID du prix (`price_...`) dans
   `STRIPE_PREMIUM_PRICE_ID`.
3. Dans **Développeurs > Clés API**, copie la clé secrète dans
   `STRIPE_SECRET_KEY` (utilise les clés `test` tant que tu n'es pas en prod).
4. Dans **Développeurs > Webhooks**, ajoute un endpoint pointant vers
   `https://ton-domaine.com/billing/webhook`, écoute au minimum les
   événements `checkout.session.completed` et `customer.subscription.deleted`.
   Copie le secret de signature dans `STRIPE_WEBHOOK_SECRET`.
5. En local, teste les webhooks avec la Stripe CLI :
   `stripe listen --forward-to localhost:3000/billing/webhook`

## Déployer en production

Deux options simples et peu coûteuses :

**Railway** (recommandé pour démarrer) :
1. Crée un compte sur railway.app, connecte ton repo GitHub
2. Railway détecte le `package.json` et déploie automatiquement
3. Ajoute les variables d'environnement du `.env` dans l'onglet Variables
4. Railway te donne une URL publique (`xxx.up.railway.app`) — tu peux ensuite
   brancher ton propre nom de domaine (city-masters.com) dans les Settings

**Render** : même principe, "New Web Service" → connecter le repo → ajouter
les variables d'environnement.

⚠️ Le fichier SQLite (`citymasters.db`) doit vivre sur un disque persistant
(Railway et Render proposent des "volumes" — sans ça, la base est effacée à
chaque redéploiement). Pour la vraie mise à l'échelle, migrer vers Postgres
est plus sûr à long terme.

## Ce qu'il reste à faire pour un vrai lancement public

- **Adapter le front-end** (le prototype Claude actuel) pour appeler ces
  routes HTTP au lieu de `window.claude.use('db')` — je peux le faire dans
  un prochain message si tu veux.
- **Rate limiting** sur `/auth/*` pour éviter le bruteforce (ex: `express-rate-limit`)
- **Validation d'email** (envoi d'un lien de confirmation) avant d'activer un compte
- **RGPD** : politique de confidentialité, export/suppression de compte
- **Nom de domaine** : achat via Namecheap/OVH/Google Domains, à pointer vers
  ton hébergeur (Railway/Render donnent les instructions DNS exactes)
- **Modération** : les pseudos/emails restent ta responsabilité légale (CGU,
  âge minimum si mécanique de type loot box, cf. discussion précédente sur
  la réglementation belge/néerlandaise)

## Structure du projet

```
server.js           → point d'entrée, assemble les routes
db.js                → schéma SQLite
data/cities.js        → données des villes (source de vérité, identique au prototype)
lib/game.js           → logique de jeu (charges, tirage, calcul du maire)
middleware/auth.js     → vérification du JWT
routes/auth.js         → inscription / connexion
routes/game.js         → profil, packs, villes, collection, classement, historique
routes/market.js       → enchères (liste, enchérir, clôture automatique)
routes/billing.js      → Stripe (abonnement Premium)
```
