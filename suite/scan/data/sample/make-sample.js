// Builds data/sample/printings.json from the table below. Run: node data/sample/make-sample.js
// Names and set codes are public facts typed by hand; collector numbers are best effort and are NOT
// checked against a provider. Prices are SYNTHETIC demo numbers (source "synthetic-demo"), not real.
// No tcgplayerProductId is set: we have no real source for them here.
import { writeFileSync } from 'node:fs';
import { makePrintingId } from '../../../shared/models.js';

const MTG = ['nonfoil', 'foil'];
const HOLO = ['holo', 'reverse-holo'];
const YGO = ['unlimited', 'first-edition'];
const OP = ['nonfoil', 'foil'];
// game, name, setCode, setName, number, finishes, rarity, base price in cents
const T = [
  ['mtg', 'Lightning Bolt', 'M11', 'Magic 2011', '149', MTG, 'common', 150],
  ['mtg', 'Counterspell', 'MH2', 'Modern Horizons 2', '267', MTG, 'uncommon', 220],
  ['mtg', 'Sol Ring', 'CMD', 'Commander 2011', '259', MTG, 'uncommon', 1400],
  ['mtg', 'Llanowar Elves', 'DOM', 'Dominaria', '168', MTG, 'common', 40],
  ['mtg', 'Dark Ritual', 'A25', 'Masters 25', '82', MTG, 'common', 180],
  ['mtg', 'Path to Exile', 'CON', 'Conflux', '15', MTG, 'uncommon', 1100],
  ['mtg', 'Birds of Paradise', 'M12', 'Magic 2012', '165', MTG, 'rare', 350],
  ['mtg', 'Black Lotus', 'LEA', 'Limited Edition Alpha', '232', ['nonfoil'], 'rare', 4500000],
  ['mtg', 'Giant Growth', 'M19', 'Core Set 2019', '176', MTG, 'common', 15],
  ['mtg', 'Serra Angel', 'DOM', 'Dominaria', '38', MTG, 'uncommon', 60],
  ['mtg', 'Shivan Dragon', 'M19', 'Core Set 2019', '159', MTG, 'rare', 90],
  ['mtg', 'Wrath of God', 'A25', 'Masters 25', '47', MTG, 'rare', 400],
  ['mtg', 'Cultivate', 'M21', 'Core Set 2021', '178', MTG, 'common', 20],
  ['mtg', 'Rhystic Study', 'PCY', 'Prophecy', '45', ['nonfoil'], 'rare', 4000],
  ['mtg', 'Swords to Plowshares', '2XM', 'Double Masters', '36', MTG, 'uncommon', 2200],
  ['mtg', 'Command Tower', 'CMD', 'Commander 2011', '270', MTG, 'common', 100],
  ['mtg', 'Arcane Signet', 'ELD', 'Throne of Eldraine', '331', MTG, 'common', 120],
  ['mtg', 'Cyclonic Rift', 'RTR', 'Return to Ravnica', '35', MTG, 'rare', 1300],
  ['mtg', 'Demonic Tutor', 'UMA', 'Ultimate Masters', '93', MTG, 'uncommon', 1800],
  ['mtg', 'Brainstorm', 'EMA', 'Eternal Masters', '38', MTG, 'common', 130],
  ['mtg', 'Lightning Helix', 'RAV', 'Ravnica: City of Guilds', '213', MTG, 'uncommon', 200],
  ['mtg', 'Mulldrifter', 'LRW', 'Lorwyn', '66', MTG, 'common', 80],
  ['mtg', 'Island', 'M21', 'Core Set 2021', '265', MTG, 'common', 5],
  ['mtg', 'Forest', 'M21', 'Core Set 2021', '274', MTG, 'common', 5],
  ['mtg', 'Goblin Guide', 'ZEN', 'Zendikar', '126', MTG, 'rare', 900],
  ['mtg', 'Thoughtseize', 'THS', 'Theros', '107', MTG, 'rare', 1500],
  ['mtg', 'Snapcaster Mage', 'ISD', 'Innistrad', '78', MTG, 'rare', 2500],
  ['pokemon', 'Charizard', 'BASE1', 'Base Set', '4', HOLO.concat('first-edition'), 'rare holo', 25000],
  ['pokemon', 'Blastoise', 'BASE1', 'Base Set', '2', HOLO.concat('first-edition'), 'rare holo', 12000],
  ['pokemon', 'Venusaur', 'BASE1', 'Base Set', '15', HOLO.concat('first-edition'), 'rare holo', 9000],
  ['pokemon', 'Pikachu', 'BASE1', 'Base Set', '58', ['unlimited', 'first-edition'], 'common', 1500],
  ['pokemon', 'Mewtwo', 'BASE1', 'Base Set', '10', HOLO.concat('first-edition'), 'rare holo', 4000],
  ['pokemon', 'Alakazam', 'BASE1', 'Base Set', '1', HOLO.concat('first-edition'), 'rare holo', 3000],
  ['pokemon', 'Charmander', 'BASE1', 'Base Set', '46', ['unlimited', 'first-edition'], 'common', 800],
  ['pokemon', 'Squirtle', 'BASE1', 'Base Set', '63', ['unlimited', 'first-edition'], 'common', 700],
  ['pokemon', 'Bulbasaur', 'BASE1', 'Base Set', '44', ['unlimited', 'first-edition'], 'common', 600],
  ['pokemon', 'Raichu', 'BASE1', 'Base Set', '14', HOLO.concat('first-edition'), 'rare holo', 2500],
  ['pokemon', 'Charizard ex', 'SV3', 'Obsidian Flames', '125', HOLO, 'double rare', 600],
  ['pokemon', 'Pikachu ex', 'SV8', 'Surging Sparks', '57', HOLO, 'double rare', 300],
  ['pokemon', 'Mew ex', 'SV3PT5', 'Scarlet & Violet 151', '151', HOLO, 'double rare', 250],
  ['pokemon', 'Umbreon VMAX', 'SWSH7', 'Evolving Skies', '215', HOLO, 'secret rare', 70000],
  ['pokemon', 'Rayquaza VMAX', 'SWSH7', 'Evolving Skies', '218', HOLO, 'secret rare', 30000],
  ['pokemon', 'Lugia V', 'SWSH12', 'Silver Tempest', '186', HOLO, 'ultra rare', 4500],
  ['pokemon', 'Professor\'s Research', 'SVI', 'Scarlet & Violet', '189', HOLO, 'uncommon', 20],
  ['pokemon', 'Iono', 'SV2', 'Paldea Evolved', '185', HOLO, 'uncommon', 150],
  ['pokemon', 'Arceus VSTAR', 'SWSH9', 'Brilliant Stars', '123', HOLO, 'ultra rare', 400],
  ['pokemon', 'Gardevoir ex', 'SVI', 'Scarlet & Violet', '86', HOLO, 'double rare', 200],
  ['pokemon', 'Miraidon ex', 'SVI', 'Scarlet & Violet', '81', HOLO, 'double rare', 150],
  ['pokemon', 'Gengar', 'BASE1', 'Base Set', '5', HOLO.concat('first-edition'), 'rare holo', 3500],
  ['pokemon', 'Eevee', 'JU', 'Jungle', '51', ['unlimited', 'first-edition'], 'common', 500],
  ['pokemon', 'Snorlax', 'JU', 'Jungle', '11', HOLO.concat('first-edition'), 'rare holo', 4000],
  ['pokemon', 'Dragonite', 'FO', 'Fossil', '4', HOLO.concat('first-edition'), 'rare holo', 6000],
  ['pokemon', 'Pikachu', 'SVP', 'Scarlet & Violet Promos', '085', HOLO, 'promo', 400],
  ['yugioh', 'Blue-Eyes White Dragon', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN001', YGO, 'ultra rare', 25000],
  ['yugioh', 'Dark Magician', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN005', YGO, 'ultra rare', 15000],
  ['yugioh', 'Red-Eyes Black Dragon', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN070', YGO, 'ultra rare', 6000],
  ['yugioh', 'Exodia the Forbidden One', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN124', YGO, 'ultra rare', 9000],
  ['yugioh', 'Pot of Greed', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN119', YGO, 'rare', 2000],
  ['yugioh', 'Monster Reborn', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN118', YGO, 'ultra rare', 3500],
  ['yugioh', 'Mirror Force', 'MRD', 'Metal Raiders', 'EN138', YGO, 'super rare', 2000],
  ['yugioh', 'Ash Blossom & Joyous Spring', 'MACR', 'Maximum Crisis', 'EN036', ['unlimited', 'first-edition'], 'secret rare', 700],
  ['yugioh', 'Dark Magician Girl', 'MFC', 'Magician\'s Force', 'EN000', YGO, 'ultra rare', 12000],
  ['yugioh', 'Time Wizard', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN065', YGO, 'rare', 2500],
  ['yugioh', 'Raigeki', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN053', YGO, 'super rare', 3000],
  ['yugioh', 'Change of Heart', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN051', YGO, 'super rare', 2500],
  ['yugioh', 'Swords of Revealing Light', 'MRD', 'Metal Raiders', 'EN056', YGO, 'super rare', 1200],
  ['yugioh', 'Jinzo', 'PSV', 'Pharaoh\'s Servant', 'EN000', YGO, 'ultra rare', 2800],
  ['yugioh', 'Call of the Haunted', 'LON', 'Labyrinth of Nightmare', 'EN048', YGO, 'ultra rare', 1500],
  ['yugioh', 'Imperial Order', 'LON', 'Labyrinth of Nightmare', 'EN049', YGO, 'secret rare', 2200],
  ['yugioh', 'Thousand Dragon', 'LON', 'Labyrinth of Nightmare', 'EN045', YGO, 'ultra rare', 1800],
  ['yugioh', 'Harpie Lady', 'MRD', 'Metal Raiders', 'EN033', YGO, 'common', 300],
  ['yugioh', 'Kuriboh', 'MRD', 'Metal Raiders', 'EN010', YGO, 'common', 250],
  ['yugioh', 'Gaia The Fierce Knight', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN062', YGO, 'common', 600],
  ['yugioh', 'Left Arm of the Forbidden One', 'LOB', 'Legend of Blue Eyes White Dragon', 'EN121', YGO, 'ultra rare', 1500],
  ['onepiece', 'Roronoa Zoro', 'OP01', 'Romance Dawn', '001', OP, 'leader', 400],
  ['onepiece', 'Monkey D. Luffy', 'OP01', 'Romance Dawn', '003', OP, 'leader', 600],
  ['onepiece', 'Nami', 'OP01', 'Romance Dawn', '016', OP, 'rare', 300],
  ['onepiece', 'Roronoa Zoro', 'OP01', 'Romance Dawn', '025', OP, 'rare', 800],
  ['onepiece', 'Donquixote Doflamingo', 'OP01', 'Romance Dawn', '060', OP, 'leader', 500],
  ['onepiece', 'Monkey D. Luffy', 'ST01', 'Starter Deck: Straw Hat Crew', '001', OP, 'leader', 200],
  ['onepiece', 'Usopp', 'ST01', 'Starter Deck: Straw Hat Crew', '004', OP, 'common', 20],
  ['onepiece', 'Sanji', 'ST01', 'Starter Deck: Straw Hat Crew', '005', OP, 'common', 25],
  ['onepiece', 'Nami', 'ST01', 'Starter Deck: Straw Hat Crew', '007', OP, 'common', 25],
  ['onepiece', 'Tony Tony.Chopper', 'ST01', 'Starter Deck: Straw Hat Crew', '006', OP, 'common', 20],
  ['onepiece', 'Portgas.D.Ace', 'OP02', 'Paramount War', '013', OP, 'leader', 700],
  ['onepiece', 'Edward.Newgate', 'OP02', 'Paramount War', '001', OP, 'leader', 900],
  ['onepiece', 'Trafalgar Law', 'OP02', 'Paramount War', '062', OP, 'leader', 500],
  ['onepiece', 'Boa Hancock', 'OP03', 'Pillars of Strength', '116', OP, 'secret rare', 3500],
  ['onepiece', 'Kaido', 'OP04', 'Kingdoms of Intrigue', '044', OP, 'leader', 600],
  ['onepiece', 'Monkey D. Luffy', 'OP05', 'Awakening of the New Era', '060', OP, 'leader', 2500],
  ['onepiece', 'Enel', 'OP05', 'Awakening of the New Era', '098', OP, 'leader', 900],
  ['onepiece', 'Shanks', 'OP01', 'Romance Dawn', '120', OP, 'secret rare', 6000],
  ['onepiece', 'Sabo', 'OP04', 'Kingdoms of Intrigue', '083', OP, 'rare', 350],
  ['onepiece', 'Yamato', 'OP06', 'Wings of the Captain', '022', OP, 'rare', 300],
  ['onepiece', 'Vinsmoke Reiju', 'OP06', 'Wings of the Captain', '031', OP, 'rare', 150],
  ['onepiece', 'Gol.D.Roger', 'OP13', 'Carrying on His Will', '118', OP, 'secret rare', 5000],
];

// Deterministic fake low/mid/market around the base, per finish (foil-like costs more).
const out = T.map(([game, name, setCode, setName, number, finishes, rarity, base]) => {
  const byFinish = {};
  finishes.forEach((f, i) => {
    const m = Math.max(1, Math.round(base * (1 + i * 0.6)));
    byFinish[f] = { market: m, low: Math.max(1, Math.round(m * 0.85)), mid: Math.round(m * 1.1) };
  });
  const slug = (setCode + '-' + number + '-' + name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id: makePrintingId(game, 'sample', slug), game, name, setCode, setName, number, finishes, language: 'en', rarity,
    prices: { asOf: '2026-10-15', source: 'synthetic-demo', byFinish },
  };
});
writeFileSync(new URL('./printings.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('wrote', out.length, 'printings');
