// Board data shared by the server (rules) and the client (rendering).

export const GROUP_COLORS = {
  brown: '#8B4A2B',
  lightblue: '#9ED6F2',
  pink: '#D93A96',
  orange: '#F7941D',
  red: '#E8202A',
  yellow: '#FFE500',
  green: '#1FB25A',
  darkblue: '#1D5FB8',
};

const P = (name, group, price, house, rent) => ({ name, type: 'property', group, price, house, rent });
const RR = (name) => ({ name, type: 'railroad', price: 200 });
const UT = (name) => ({ name, type: 'utility', price: 150 });

export const TILES = [
  { name: 'GO', type: 'go' },
  P('Mediterranean Avenue', 'brown', 60, 50, [2, 10, 30, 90, 160, 250]),
  { name: 'Community Chest', type: 'chest' },
  P('Baltic Avenue', 'brown', 60, 50, [4, 20, 60, 180, 320, 450]),
  { name: 'Income Tax', type: 'tax', amount: 200 },
  RR('Reading Railroad'),
  P('Oriental Avenue', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  { name: 'Chance', type: 'chance' },
  P('Vermont Avenue', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  P('Connecticut Avenue', 'lightblue', 120, 50, [8, 40, 100, 300, 450, 600]),
  { name: 'Jail', type: 'jail' },
  P('St. Charles Place', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  UT('Electric Company'),
  P('States Avenue', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  P('Virginia Avenue', 'pink', 160, 100, [12, 60, 180, 500, 700, 900]),
  RR('Pennsylvania Railroad'),
  P('St. James Place', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  { name: 'Community Chest', type: 'chest' },
  P('Tennessee Avenue', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  P('New York Avenue', 'orange', 200, 100, [16, 80, 220, 600, 800, 1000]),
  { name: 'Free Parking', type: 'parking' },
  P('Kentucky Avenue', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  { name: 'Chance', type: 'chance' },
  P('Indiana Avenue', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  P('Illinois Avenue', 'red', 240, 150, [20, 100, 300, 750, 925, 1100]),
  RR('B. & O. Railroad'),
  P('Atlantic Avenue', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  P('Ventnor Avenue', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  UT('Water Works'),
  P('Marvin Gardens', 'yellow', 280, 150, [24, 120, 360, 850, 1025, 1200]),
  { name: 'Go To Jail', type: 'gotojail' },
  P('Pacific Avenue', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  P('North Carolina Avenue', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  { name: 'Community Chest', type: 'chest' },
  P('Pennsylvania Avenue', 'green', 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  RR('Short Line'),
  { name: 'Chance', type: 'chance' },
  P('Park Place', 'darkblue', 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  { name: 'Luxury Tax', type: 'tax', amount: 100 },
  P('Boardwalk', 'darkblue', 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];

export const isOwnable = (i) => ['property', 'railroad', 'utility'].includes(TILES[i].type);

export const OWNABLE = TILES.map((_, i) => i).filter(isOwnable);

export const GROUPS = {};
TILES.forEach((t, i) => {
  if (t.type === 'property') (GROUPS[t.group] ||= []).push(i);
});

export const RAILROADS = [5, 15, 25, 35];
export const UTILITIES = [12, 28];

export const mortgageValue = (i) => TILES[i].price / 2;
export const unmortgageCost = (i) => Math.ceil(mortgageValue(i) * 1.1);

export const CHANCE = [
  { text: 'Advance to Boardwalk.', a: { type: 'advance', to: 39 } },
  { text: 'Advance to GO. Collect $200.', a: { type: 'advance', to: 0 } },
  { text: 'Advance to Illinois Avenue. If you pass GO, collect $200.', a: { type: 'advance', to: 24 } },
  { text: 'Advance to St. Charles Place. If you pass GO, collect $200.', a: { type: 'advance', to: 11 } },
  { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rent.', a: { type: 'nearest', kind: 'railroad' } },
  { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rent.', a: { type: 'nearest', kind: 'railroad' } },
  { text: 'Advance to the nearest Utility. If owned, pay the owner 10× the dice roll.', a: { type: 'nearest', kind: 'utility' } },
  { text: 'Bank pays you a dividend of $50.', a: { type: 'money', amount: 50 } },
  { text: 'Get Out of Jail Free. Keep this card until needed.', a: { type: 'jailfree' } },
  { text: 'Go back 3 spaces.', a: { type: 'back', n: 3 } },
  { text: 'Go directly to Jail. Do not pass GO, do not collect $200.', a: { type: 'jail' } },
  { text: 'Make general repairs on all your property: $25 per house, $100 per hotel.', a: { type: 'repairs', house: 25, hotel: 100 } },
  { text: 'Speeding fine. Pay $15.', a: { type: 'money', amount: -15 } },
  { text: 'Take a trip to Reading Railroad. If you pass GO, collect $200.', a: { type: 'advance', to: 5 } },
  { text: 'You have been elected Chairman of the Board. Pay each player $50.', a: { type: 'each', amount: -50 } },
  { text: 'Your building loan matures. Collect $150.', a: { type: 'money', amount: 150 } },
];

export const CHEST = [
  { text: 'Advance to GO. Collect $200.', a: { type: 'advance', to: 0 } },
  { text: 'Bank error in your favor. Collect $200.', a: { type: 'money', amount: 200 } },
  { text: "Doctor's fee. Pay $50.", a: { type: 'money', amount: -50 } },
  { text: 'From sale of stock you get $50.', a: { type: 'money', amount: 50 } },
  { text: 'Get Out of Jail Free. Keep this card until needed.', a: { type: 'jailfree' } },
  { text: 'Go directly to Jail. Do not pass GO, do not collect $200.', a: { type: 'jail' } },
  { text: 'Holiday fund matures. Receive $100.', a: { type: 'money', amount: 100 } },
  { text: 'Income tax refund. Collect $20.', a: { type: 'money', amount: 20 } },
  { text: 'It is your birthday. Collect $10 from every player.', a: { type: 'each', amount: 10 } },
  { text: 'Life insurance matures. Collect $100.', a: { type: 'money', amount: 100 } },
  { text: 'Pay hospital fees of $100.', a: { type: 'money', amount: -100 } },
  { text: 'Pay school fees of $50.', a: { type: 'money', amount: -50 } },
  { text: 'Receive $25 consultancy fee.', a: { type: 'money', amount: 25 } },
  { text: 'You are assessed for street repairs: $40 per house, $115 per hotel.', a: { type: 'repairs', house: 40, hotel: 115 } },
  { text: 'You have won second prize in a beauty contest. Collect $10.', a: { type: 'money', amount: 10 } },
  { text: 'You inherit $100.', a: { type: 'money', amount: 100 } },
];

export const PLAYER_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00'];
export const TOKENS = ['car', 'hat', 'rocket', 'pawn', 'gem', 'crown'];
export const TOKEN_EMOJI = { car: '🚗', hat: '🎩', rocket: '🚀', pawn: '♟️', gem: '💎', crown: '👑' };

export const MAX_PLAYERS = 6;
export const START_MONEY = 1500;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
