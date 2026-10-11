// Property card data shared by the board, the card dialog and the art exporter
// (layout from the "World Property Cards" design).
import { rentOf } from './engine.js';

export const UTILITY_COLOR = '#6c74d8';
export const TRAVEL_COLOR = '#2a9fb8';
export const INK = '#1A0F14';

// Landmark art ids: the city name in lower case with accents and spaces removed, except a few short ones.
const SPECIAL = { 'Mexico City': 'mexico', 'Rio de Janeiro': 'rio' };
export function landmarkId(name) {
  return SPECIAL[name] ?? name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '_');
}
export const landmarkUrl = (id) => `/cards/${id}.svg`;

// Same colour mixing as the design's components.
export function mix(hex, target, amt) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return hex;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (target - v) * amt));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Everything a card face shows for a property (city or utility).
 * `props` is the game's props map and `players` the player list, for owner and set position.
 * Owned cards show the rent due instead of the price.
 */
export function cardModel(state, i) {
  const x = state.props[i];
  const isUtility = x.kind === 'utility';
  const travel = isUtility && x.group === 'travel';
  const color = travel ? TRAVEL_COLOR : isUtility ? UTILITY_COLOR : x.color;
  const group = isUtility
    ? Object.keys(state.props).map(Number).filter((k) => state.props[k].kind === 'utility' && state.props[k].group === x.group)
    : state.countries[x.country];
  const owner = x.owner != null ? state.players[x.owner] : null;
  const n = x.name.length;
  return {
    kind: x.kind,
    city: x.name,
    setName: travel ? 'Travel' : isUtility ? 'Utility' : x.countryName,
    badge: isUtility ? '' : x.country.replace(/^S/, ''),
    idx: group.indexOf(i) + 1,
    total: group.length,
    price: owner ? `Rent ${rentOf(state, x).toLocaleString('en-IN')}` : x.price.toLocaleString('en-IN'),
    rented: !!owner,
    color,
    artBg: mix(color, 255, 0.5),
    shade: mix(color, 0, 0.25),
    nameSize: n <= 8 ? 36 : n <= 10 ? 32 : n <= 12 ? 28 : 25,
    lm: isUtility ? x.lm : landmarkId(x.name),
    owner: owner ? { name: owner.name, color: owner.color, token: owner.token } : null,
    mortgaged: !!x.mortgaged,
    steps: x.steps || 0,
  };
}

// Corner pads: colour, darker rim and the design's icon paths (100x100 box).
export const CORNER_PADS = {
  // The arrow points the way play goes: from Start to space 1, which is to the left on screen.
  start: { color: '#7bd389', rim: '#4E9E5C', label: 'START', icon: [
    { d: 'M88,40 L46,40 L46,20 L12,50 L46,80 L46,60 L88,60 Z', fill: '#ffffff', sw: 7 }] },
  auction: { color: '#ffb347', rim: '#C9802A', label: 'AUCTION', icon: [
    { d: 'M40,38 h12 v44 h-12 Z', fill: '#C9874A', sw: 7, rotate: [-35, 46, 42] },
    { d: 'M20,16 h52 v26 h-52 Z', fill: '#ffffff', sw: 7, rotate: [-35, 46, 42] },
    { d: 'M50,76 h40 v14 h-40 Z', fill: '#ffffff', sw: 7 }] },
  jail: { color: '#9aa3ad', rim: '#6B747E', label: 'JAIL', icon: [
    { d: 'M16,16 h68 v68 h-68 Z', fill: '#ffffff', sw: 7 },
    { d: 'M34,18 L34,82 M50,18 L50,82 M66,18 L66,82', fill: 'none', sw: 7 },
    { d: 'M18,50 L82,50', fill: 'none', sw: 5 }] },
  chance: { color: '#ffd23f', rim: '#C99F1A', label: 'CHANCE', icon: [
    { d: 'M22,10 h56 v80 h-56 Z', fill: '#ffffff', sw: 7, rotate: [8, 50, 50] },
    { d: 'M38,38 Q38,24 51,24 Q64,24 64,36 Q64,45 53,50 L53,60', fill: 'none', sw: 9 },
    { d: 'M47.5,74 a5.5,5.5 0 1,0 11,0 a5.5,5.5 0 1,0 -11,0', fill: INK, sw: 0 }] },
  tax: { color: '#f78fb3', rim: '#C25E83', label: 'TAX', icon: [
    { d: 'M30,40 Q16,88 50,88 Q84,88 70,40 Z', fill: '#ffffff', sw: 7 },
    { d: 'M36,40 L64,40 L58,28 L68,14 L32,14 L42,28 Z', fill: '#ffffff', sw: 7 },
    { d: 'M35,58 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0', fill: 'none', sw: 4.5 },
    { d: 'M55,76 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0', fill: 'none', sw: 4.5 },
    { d: 'M62,54 L38,80', fill: 'none', sw: 5 }] },
  shop: { color: '#7ec8ff', rim: '#4A93CC', label: 'SHOPPING', icon: [
    { d: 'M36,40 Q36,16 50,16 Q64,16 64,40', fill: 'none', sw: 7 },
    { d: 'M20,36 L80,36 L76,88 L24,88 Z', fill: '#ffffff', sw: 7 },
    { d: 'M38,54 Q50,66 62,54', fill: 'none', sw: 6 }] },
};
