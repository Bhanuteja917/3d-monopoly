// Content catalog (PRD §4, §6, §14, §15), with the fixed 45-space board. Adding regions, cities, cards or vehicles is a data change only.

// Player characters (art in public/characters, from the Redline #88 character design file).
// Player colours stay Okabe-Ito for colour-blind safety (FR-012); each is matched to the character's art.
export const TOKENS = [
  { id: 'redline', name: 'Redline #88', kind: 'Race car', color: '#D55E00', colorName: 'Vermillion' },
  { id: 'bug', name: 'Bug', kind: 'Mantis beetle', color: '#009E73', colorName: 'Bluish green' },
  { id: 'ronin', name: 'Ronin', kind: 'Samurai', color: '#0072B2', colorName: 'Blue' },
  { id: 'moko', name: 'Moko', kind: 'Cloud sage', color: '#CC79A7', colorName: 'Reddish purple' },
  { id: 'scorch', name: 'Scorch', kind: 'Wyvern', color: '#1A1A1A', colorName: 'Black' },
  { id: 'override', name: 'Override', kind: 'Battle robot', color: '#56B4E9', colorName: 'Sky blue' },
  { id: 'mort', name: 'Mort', kind: 'Zombie tycoon', color: '#F0E442', colorName: 'Yellow' },
  { id: 'talon', name: 'Talon', kind: 'Eagle', color: '#E69F00', colorName: 'Orange' },
];

// Visual regions: building style, ground colour and the region label on the board.
export const REGIONS = [
  { id: 'NA', name: 'North America', style: 'modern', ground: '#8fd16a' },
  { id: 'SA', name: 'South America', style: 'colonial', ground: '#7fcf5a' },
  { id: 'EU', name: 'Europe', style: 'classic', ground: '#9ad66e' },
  { id: 'UKI', name: 'UK', style: 'brick', ground: '#86cf64' },
  { id: 'ME', name: 'Middle East', style: 'desert', ground: '#e8cc84' },
  { id: 'AF', name: 'Africa', style: 'savanna', ground: '#c9d46a' },
  { id: 'SEA', name: 'Southeast Asia', style: 'tropical', ground: '#6fcf6a' },
  { id: 'ANZ', name: 'Oceania', style: 'coastal', ground: '#92d873' },
  { id: 'IN', name: 'India', style: 'indian', ground: '#b9d36a' },
];

// Property sets (owning every city in a set completes it). Prices rise along the board, set 1 to set 12,
// within the PRD's 4x range. Each set has its own colour so no two sets look alike.
export const SETS = [
  { id: 'S1', name: 'North America', region: 'NA', color: '#8d5524', price: 1000, cities: ['Vancouver', 'Mexico City'] },
  { id: 'S2', name: 'South America', region: 'SA', color: '#5bc0eb', price: 1200, cities: ['São Paulo', 'Rio de Janeiro', 'Buenos Aires'] },
  { id: 'S3', name: 'Germany', region: 'EU', color: '#3d3d3d', price: 1400, cities: ['Berlin', 'Munich'] },
  { id: 'S4', name: 'Continental Europe', region: 'EU', color: '#f5871f', price: 1600, cities: ['Paris', 'Rome', 'Budapest'] },
  { id: 'S5', name: 'England', region: 'UKI', color: '#e63946', price: 1800, cities: ['London', 'Manchester', 'Birmingham'] },
  { id: 'S6', name: 'Gulf', region: 'ME', color: '#f7c815', price: 2000, cities: ['Riyadh', 'Doha'] },
  { id: 'S7', name: 'UAE', region: 'ME', color: '#2fae5a', price: 2200, cities: ['Dubai', 'Abu Dhabi'] },
  { id: 'S8', name: 'South Africa', region: 'AF', color: '#1f4e9c', price: 2400, cities: ['Johannesburg', 'Cape Town'] },
  { id: 'S9', name: 'West & East Africa', region: 'AF', color: '#8e44ad', price: 2800, cities: ['Lagos', 'Abuja', 'Nairobi'] },
  { id: 'S10', name: 'Southeast Asia', region: 'SEA', color: '#14a3a3', price: 3200, cities: ['Jakarta', 'Bangkok', 'Kuala Lumpur', 'Phuket'] },
  { id: 'S11', name: 'Oceania', region: 'ANZ', color: '#9ccc3a', price: 3600, cities: ['Auckland', 'Sydney', 'Melbourne'] },
  { id: 'S12', name: 'India', region: 'IN', color: '#e0218a', price: 4000, cities: ['Delhi', 'Mumbai', 'Bangalore', 'Hyderabad'] },
];

export const UTILITIES = [
  { id: 'UT-DAM', name: 'Hydro Dam', model: 'dam', lm: 'hydro', region: 'SA' },
  { id: 'UT-RAIL', name: 'High-Speed Rail', model: 'rail', lm: 'rail', region: 'EU' },
  { id: 'UT-OIL', name: 'Oil Refinery', model: 'refinery', lm: 'refinery', region: 'ME' },
  { id: 'UT-SOLAR', name: 'Solar Farm', model: 'solar', lm: 'solar', region: 'AF' },
  { id: 'UT-PORT', name: 'Seaport', model: 'seaport', lm: 'seaport', region: 'SEA' },
  { id: 'UT-AIR', name: 'Airport', model: 'airport', lm: 'airport', region: 'ANZ' },
];

// The board, clockwise from Start: 45 spaces for every player count.
// { corner: n } is corner slot Cn; { set } takes that set's next city; { utility } is a utility id.
const C = (corner, region) => ({ corner, region });
const T = (set) => ({ set });
const U = (utility) => ({ utility });
export const BOARD_LAYOUT = [
  C(1, 'NA'), T('S1'), T('S1'), U('UT-DAM'), T('S2'), T('S2'), T('S2'),
  C(2, 'EU'), T('S3'), T('S3'), U('UT-RAIL'), T('S4'), T('S4'), T('S4'),
  C(3, 'UKI'), T('S5'), T('S5'), T('S5'), U('UT-OIL'), T('S6'), T('S6'),
  C(4, 'ME'), T('S7'), T('S7'), U('UT-SOLAR'), T('S8'), T('S8'),
  C(5, 'AF'), T('S9'), T('S9'), T('S9'), U('UT-PORT'), T('S10'), T('S10'), T('S10'), T('S10'),
  C(6, 'ANZ'), T('S11'), T('S11'), T('S11'), U('UT-AIR'), T('S12'), T('S12'), T('S12'), T('S12'),
];

export const CORNERS = {
  start: { name: 'Start', icon: '🏁' },
  auction: { name: 'Auction', icon: '🔨' },
  jail: { name: 'Jail', icon: '🔒' },
  chance: { name: 'Chance', icon: '❓' },
  tax: { name: 'Tax', icon: '💰' },
  shop: { name: 'Shopping Center', icon: '🛍️' },
};

// Corner slots C1..C8. C2-C4 are shuffled each game (FR-024).
export const CORNER_ORDER = ['start', null, null, null, 'tax', 'shop'];
export const SHUFFLED_CORNERS = ['auction', 'jail', 'chance'];

// effect kinds: start | utility | land | corner | move | cash | birthday | jailcard | pay | payall | repairs
export const CHANCE_CARDS = [
  { id: 'CH-01', title: 'Advance to Start', text: 'Move to Start and collect 2,000.', effect: 'start' },
  { id: 'CH-02', title: 'Next utility', text: 'Move to the nearest utility. Pay rent (or take a paid trip on transport) if owned, or buy it if unowned.', effect: 'utility' },
  { id: 'CH-03', title: 'Land deal', text: 'Move to the nearest unowned city. You may buy it.', effect: 'land' },
  { id: 'CH-04', title: 'Next corner', text: 'Move to the next corner and resolve it.', effect: 'corner' },
  { id: 'CH-05', title: 'Go back 3 spaces', text: 'Move back 3 spaces and resolve the space.', effect: 'move', amount: -3 },
  { id: 'CH-06', title: 'Advance 5 spaces', text: 'Move forward 5 spaces and resolve the space.', effect: 'move', amount: 5 },
  { id: 'CH-07', title: 'Bank dividend', text: 'Collect 500.', effect: 'cash', amount: 500 },
  { id: 'CH-08', title: 'Loan matures', text: 'Collect 1,500.', effect: 'cash', amount: 1500 },
  { id: 'CH-09', title: 'Contest prize', text: 'Collect 1,000.', effect: 'cash', amount: 1000 },
  { id: 'CH-10', title: 'Birthday', text: 'Collect 100 from every other player.', effect: 'birthday', amount: 100 },
  { id: 'CH-11', title: 'Get Out of Jail Free', text: 'Keep this card until used.', effect: 'jailcard' },
  { id: 'CH-12', title: 'Speeding fine', text: 'Pay 150.', effect: 'pay', amount: 150 },
  { id: 'CH-13', title: "Doctor's fee", text: 'Pay 500.', effect: 'pay', amount: 500 },
  { id: 'CH-14', title: 'Poor tax', text: 'Pay 150.', effect: 'pay', amount: 150 },
  { id: 'CH-15', title: 'Elected chairman', text: 'Pay every other player 500.', effect: 'payall', amount: 500 },
  { id: 'CH-16', title: 'General repairs', text: 'Pay 200 per house, 400 per building, 800 per tower.', effect: 'repairs' },
];

export const VEHICLES = [
  { id: 'VH-01', name: 'Scooter', icon: '🛵', price: 1000, effect: 'START_SALARY_PLUS_10', text: 'Collect 10% more salary each time you pass Start' },
  { id: 'VH-02', name: 'Tuk-tuk', icon: '🛺', price: 1200, effect: 'TAX_MINUS_25', text: 'Pay 25% less on the Tax corner' },
  { id: 'VH-03', name: 'Jeep', icon: '🚙', price: 1500, effect: 'CHANCE_LOSS_HALF', text: 'Losing Chance cards cost you half' },
  { id: 'VH-04', name: 'Delivery Truck', icon: '🚚', price: 1800, effect: 'BUILD_MINUS_10', text: 'Building upgrades cost 10% less' },
  { id: 'VH-05', name: 'Sports Car', icon: '🏎️', price: 2000, effect: 'REROLL_ONCE', text: 'Once per game, reroll your dice' },
  { id: 'VH-06', name: 'Helicopter', icon: '🚁', price: 2200, effect: 'JAIL_FREE_FIRST', text: 'Leave jail on your first jail turn, no roll, no fee' },
  { id: 'VH-07', name: 'Speedboat', icon: '🚤', price: 2500, effect: 'UTILITY_PLUS_ONE', text: 'Your utilities earn rent as if you owned one more (cap still applies)' },
  { id: 'VH-08', name: 'Yacht', icon: '🛥️', price: 3000, effect: 'TRADE_NO_DEPRECIATION', text: 'Buildings you trade at Auction keep 100% of their value' },
];
