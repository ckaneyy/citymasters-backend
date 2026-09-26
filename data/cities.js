const FRANCE_CITIES = [
  { id: 'paris', name: 'Paris', pop: 2148000, tier: 'Légendaire' },
  { id: 'marseille', name: 'Marseille', pop: 870000, tier: 'Légendaire' },
  { id: 'lyon', name: 'Lyon', pop: 522000, tier: 'Épique' },
  { id: 'toulouse', name: 'Toulouse', pop: 493000, tier: 'Épique' },
  { id: 'nice', name: 'Nice', pop: 342000, tier: 'Épique' },
  { id: 'nantes', name: 'Nantes', pop: 320000, tier: 'Épique' },
  { id: 'montpellier', name: 'Montpellier', pop: 295000, tier: 'Épique' },
  { id: 'strasbourg', name: 'Strasbourg', pop: 290000, tier: 'Épique' },
  { id: 'bordeaux', name: 'Bordeaux', pop: 260000, tier: 'Rare' },
  { id: 'lille', name: 'Lille', pop: 233000, tier: 'Rare' },
  { id: 'rennes', name: 'Rennes', pop: 220000, tier: 'Rare' },
  { id: 'reims', name: 'Reims', pop: 182000, tier: 'Rare' },
  { id: 'dijon', name: 'Dijon', pop: 156000, tier: 'Rare' },
  { id: 'angers', name: 'Angers', pop: 152000, tier: 'Rare' },
  { id: 'lemans', name: 'Le Mans', pop: 143000, tier: 'Rare' },
  { id: 'brest', name: 'Brest', pop: 139000, tier: 'Rare' },
  { id: 'perpignan', name: 'Perpignan', pop: 121000, tier: 'Rare' },
  { id: 'metz', name: 'Metz', pop: 117000, tier: 'Rare' },
  { id: 'ajaccio', name: 'Ajaccio', pop: 71000, tier: 'Commun' },
  { id: 'colmar', name: 'Colmar', pop: 69000, tier: 'Commun' },
  { id: 'vannes', name: 'Vannes', pop: 53000, tier: 'Commun' },
  { id: 'albi', name: 'Albi', pop: 49000, tier: 'Commun' },
  { id: 'carcassonne', name: 'Carcassonne', pop: 45000, tier: 'Commun' },
  { id: 'chartres', name: 'Chartres', pop: 39000, tier: 'Commun' },
].map(c => ({ ...c, country: 'france' }));

const JAPAN_CITIES = [
  { id: 'tokyo', name: 'Tokyo', pop: 14000000, tier: 'Légendaire' },
  { id: 'yokohama', name: 'Yokohama', pop: 3760000, tier: 'Légendaire' },
  { id: 'osaka', name: 'Osaka', pop: 2750000, tier: 'Épique' },
  { id: 'nagoya', name: 'Nagoya', pop: 2320000, tier: 'Épique' },
  { id: 'sapporo', name: 'Sapporo', pop: 1960000, tier: 'Épique' },
  { id: 'fukuoka', name: 'Fukuoka', pop: 1610000, tier: 'Épique' },
  { id: 'kobe', name: 'Kobe', pop: 1520000, tier: 'Rare' },
  { id: 'kyoto', name: 'Kyoto', pop: 1460000, tier: 'Rare' },
  { id: 'hiroshima', name: 'Hiroshima', pop: 1200000, tier: 'Rare' },
  { id: 'sendai', name: 'Sendai', pop: 1090000, tier: 'Rare' },
  { id: 'kagoshima', name: 'Kagoshima', pop: 595000, tier: 'Commun' },
  { id: 'nagasaki', name: 'Nagasaki', pop: 410000, tier: 'Commun' },
  { id: 'kanazawa', name: 'Kanazawa', pop: 462000, tier: 'Commun' },
  { id: 'nara', name: 'Nara', pop: 353000, tier: 'Commun' },
].map(c => ({ ...c, country: 'japon' }));

const CITIES = [...FRANCE_CITIES, ...JAPAN_CITIES];
const CITY_BY_ID = Object.fromEntries(CITIES.map(c => [c.id, c]));

const COUNTRIES = [
  { id: 'france', name: 'France' },
  { id: 'japon', name: 'Japon' },
];

const TIER_WEIGHTS = { Commun: 55, Rare: 30, Épique: 12, Légendaire: 3 };
const SHINY_CHANCE = 0.03;
const SUGGESTED_PRICE = { Commun: 20, Rare: 60, Épique: 200, Légendaire: 800 };

module.exports = { CITIES, CITY_BY_ID, COUNTRIES, TIER_WEIGHTS, SHINY_CHANCE, SUGGESTED_PRICE };
