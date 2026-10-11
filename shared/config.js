// Economy constants and limits (PRD §17.2, §22). Tune here; no rule code changes needed.
export const CONFIG = {
  minPlayers: 4,
  maxPlayers: 8,
  dice: 2, // every player count rolls two dice on the 45-space board

  startingCash: 15000,
  startSalary: 2000,
  utilityPrice: 2000,

  cityRentBase: 0.10, // unbuilt rent multiplies by how many cities of the set the owner holds (2 -> x2, 3 -> x3)
  cityRentByStep: [0, 0.50, 1.25, 2.50], // none, house, building, tower

  buildCostRate: 0.50,
  buildingResaleRate: 0.50,
  mortgageRate: 0.50,
  unmortgageRate: 0.55,

  // Utilities and travel are two separate sets of three: rent counts only the owner's holdings in the same set.
  utilityRent: [0, 250, 500, 1000, 2000], // by count owned in the set, capped at index 4 (Speedboat adds one)
  // Travel (rail, seaport, airport): the lander either pays the flat rent and stays, or picks one of three trips
  // and pays the owner a fare per space travelled. Fare per space = rent x this rate (250 rent -> 50 per space).
  transportModels: ['rail', 'seaport', 'airport'],
  travelFareRate: 0.2,
  travelBands: [[3, 8], [9, 16], [17, 28]], // near, mid and far trip lengths in spaces
  depreciationPerTrade: 0.75,

  jailFee: 500,
  jailEscapeFace1d6: 6,
  jailMaxFailedRolls: 2,

  taxPerStep: [0, 250, 500, 1000],
  repairsPerStep: [0, 200, 400, 800],

  botCashReserve: 3000,

  auctionResponseSeconds: 90, // every player picks a swap offer at the same time
  auctionConfirmSeconds: 45,
  swapBonus: 1000, // both players in a completed swap collect this from the bank

  // Declined purchase: the other players bid on it. Bidding opens at a random 20-50% discount; the player
  // who sent it to auction collects a random 10-15% of the winning bid from the bank.
  bidAuction: {
    discount: [0.20, 0.50],
    commission: [0.10, 0.15],
    raises: [100, 500, 1000],
    seconds: 20, // online: the clock restarts with every new bid
  },

  // Dice: two real faces, but totals are flatter than plain 2d6 and doubles come up more often.
  diceTuning: {
    flatShare: 0.4, // share of rolls whose total is drawn evenly from 2..12 instead of 2d6
    doublesChance: 0.4, // when the total can be a double, how often it is
    jackpot: 1000, // double six pays this bonus
  },


  // Limits by player count (§17.2)
  limits: {
    4: { rounds: 24, safetyCap: 48, targets: [25000, 32000, 40000] },
    5: { rounds: 18, safetyCap: 36, targets: [30000, 40000, 50000] },
    6: { rounds: 18, safetyCap: 36, targets: [30000, 40000, 50000] },
    7: { rounds: 14, safetyCap: 28, targets: [30000, 40000, 50000] },
    8: { rounds: 14, safetyCap: 28, targets: [30000, 40000, 50000] },
  },

  // Vehicle effect parameters (§15)
  vehicleEffects: {
    scooterSalaryBonus: 0.10,
    tuktukTaxDiscount: 0.25,
    jeepChanceLossFactor: 0.5,
    truckBuildDiscount: 0.10,
  },
};

export const MODES = ['both', 'wealth', 'turns', 'classic'];
