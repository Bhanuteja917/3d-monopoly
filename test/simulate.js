// Bot-only balance simulation: rounds per game, end reasons and economy stats by player count and mode.
// Usage: node test/simulate.js [gamesPerConfig=40]
import { createGame, act, whoActs, botAction } from '../shared/engine.js';

const GAMES = Number(process.argv[2]) || 40;
const SECONDS_PER_TURN = 25; // PRD §17.2 assumption

for (const n of [4, 5, 6, 7, 8]) {
  for (const mode of ['both', 'turns', 'classic']) {
    const rows = [];
    for (let g = 0; g < GAMES; g++) {
      const s = createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })), mode, seed: 1000 * n + g });
      let steps = 0;
      while (s.phase !== 'ended' && steps++ < 200000) act(s, botAction(s, whoActs(s)));
      const owned = Object.values(s.props).filter((x) => x.owner != null).length;
      const built = Object.values(s.props).reduce((a, x) => a + (x.steps || 0), 0);
      rows.push({ rounds: s.round, turns: s.turnNo, reason: s.endReason, owned, built, bankrupt: s.players.filter((p) => p.bankrupt).length });
    }
    const avg = (k) => (rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(1);
    const reasons = {};
    for (const r of rows) { const key = r.reason.replace(/\d+/g, '#'); reasons[key] = (reasons[key] || 0) + 1; }
    const minutes = ((rows.reduce((a, r) => a + r.turns, 0) / rows.length) * SECONDS_PER_TURN / 60).toFixed(0);
    console.log(`${n}p ${mode.padEnd(7)} rounds ${avg('rounds').padStart(5)}  ~${minutes} min  owned ${avg('owned')}  steps built ${avg('built')}  bankrupt ${avg('bankrupt')}  ${JSON.stringify(reasons)}`);
  }
}
