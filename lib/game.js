const { CITIES, TIER_WEIGHTS, SHINY_CHANCE } = require('../data/cities');

const MAX_CHARGES = 10;
const COOLDOWN_MS_FREE = 15 * 60 * 1000;
const COOLDOWN_MS_PREMIUM = 3 * 60 * 1000;
const MAX_LISTINGS_FREE = 5;
const MAX_LISTINGS_PREMIUM = 25;
const AUCTION_DURATION_MS = 5 * 60 * 1000;
const MAYOR_COMMISSION = 0.05;

// Recalcule le nombre de charges (packs disponibles) en tenant compte du temps
// écoulé depuis la dernière ouverture — c'est la même logique que le prototype
// client, mais ici elle fait AUTORITÉ : le client ne peut plus la falsifier.
function computeCharges(charges, lastUpdate, now, premium) {
  const cooldownMs = premium ? COOLDOWN_MS_PREMIUM : COOLDOWN_MS_FREE;
  if (charges >= MAX_CHARGES) return { charges: MAX_CHARGES, lastUpdate: now };
  const elapsed = now - lastUpdate;
  const gained = Math.floor(elapsed / cooldownMs);
  if (gained <= 0) return { charges, lastUpdate };
  const newCharges = Math.min(MAX_CHARGES, charges + gained);
  return { charges: newCharges, lastUpdate: lastUpdate + gained * cooldownMs };
}

function pickCity() {
  const tiers = Object.keys(TIER_WEIGHTS);
  const total = Object.values(TIER_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let chosenTier = tiers[tiers.length - 1];
  for (const t of tiers) {
    if (r < TIER_WEIGHTS[t]) { chosenTier = t; break; }
    r -= TIER_WEIGHTS[t];
  }
  const pool = CITIES.filter(c => c.tier === chosenTier);
  return pool[Math.floor(Math.random() * pool.length)];
}

function rollPack() {
  const pulls = [];
  for (let i = 0; i < 5; i++) {
    pulls.push({ city: pickCity(), shiny: Math.random() < SHINY_CHANCE });
  }
  return pulls;
}

// Calcule le maire d'une ville à partir des cartes en base : score = cartes
// normales + cartes shiny * (total de cartes normales en circulation / 20).
async function computeMayor(db, cityId) {
  const { rows } = await db.query('SELECT owner_id, shiny FROM cards WHERE city_id = $1', [cityId]);
  const normalTotal = rows.filter(r => !r.shiny).length;
  const ratio = normalTotal / 20;
  const scores = {};
  for (const r of rows) scores[r.owner_id] = (scores[r.owner_id] || 0) + (r.shiny ? ratio : 1);
  let best = null, bestScore = 0;
  for (const [owner, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; best = owner; }
  }
  return { ownerId: best, score: bestScore, normalTotal };
}

module.exports = {
  MAX_CHARGES, COOLDOWN_MS_FREE, COOLDOWN_MS_PREMIUM,
  MAX_LISTINGS_FREE, MAX_LISTINGS_PREMIUM, AUCTION_DURATION_MS, MAYOR_COMMISSION,
  computeCharges, pickCity, rollPack, computeMayor,
};
