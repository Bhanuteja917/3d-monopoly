# Monopoly 3D — multiplayer, mobile-friendly

A 3D Monopoly game built with **Three.js** for 2–6 players. Each player uses their own phone (or any browser): one person creates a room and the others join it with a 4-letter code or invite link.

![stack](https://img.shields.io/badge/Three.js-r169-black) ![stack](https://img.shields.io/badge/Socket.IO-4-blue) ![node](https://img.shields.io/badge/node-%3E%3D18-green)

## Features

- **3D board.** All 40 spaces are drawn in 3D. Tokens hop across the board, the dice roll with physics-style tumbling, and houses and hotels appear on the board. Owners are shown with colored strips, and mortgaged spaces are shaded.
- **Rooms.** Create a room, share the code or link (uses the native share sheet on phones), and up to 6 players can join. The host starts the game.
- **Reconnect.** Close the tab, lock the phone or lose signal, and you're back in the game when you reopen the link.
- **Full rules, enforced on the server:**
  - Buying property, and auctions for everyone (with a live countdown) when the buyer passes
  - Rent with color-set doubling, houses and hotels (built and sold evenly), railroads and utilities
  - All 16 Chance and 16 Community Chest cards, including Get Out of Jail Free
  - Jail: three doubles in a row, paying the $50 fine, using a card, or rolling doubles to get out
  - Income and Luxury Tax, $200 for passing GO
  - Mortgaging and unmortgaging (with 10% interest)
  - Trading properties and cash between any players
  - Debt and bankruptcy: assets go to the creditor or back to the bank. The last player left wins.
- **Mobile UI.** Large touch buttons, bottom sheets, and tap-any-space to see its title deed. Drag to rotate, pinch to zoom. There's also a game log with chat, and the phone vibrates when it's your turn.
- **Host tools.** The host can remove a player who has left for good.

## Run it locally

```bash
npm install
npm start           # http://localhost:3000
```

To play on phones over the same Wi-Fi, find your computer's LAN IP (e.g. `192.168.1.20`) and open `http://192.168.1.20:3000` on each phone.

Set `PORT` to use a different port.

## Deploy so friends anywhere can join

The app is a single Node.js process (Express + Socket.IO with WebSockets), so it runs on any Node host that supports WebSockets. Rooms are kept in memory, so run **one instance**.

- **Render:** this repo includes `render.yaml`. Create a new *Blueprint* (or a Web Service with build command `npm install` and start command `npm start`).
- **Railway / Fly.io / a VPS:** `npm install && npm start`. The app listens on `$PORT`.

> Static-only and serverless hosts (GitHub Pages, plain Vercel/Netlify functions) won't work, because the game needs a long-running WebSocket server.

## How to play

1. Open the site, enter your name and tap **Create a room**.
2. Share the room code or tap **Share invite link**. Friends enter the code and tap **Join**.
3. The host taps **Start game** once 2–6 players are in.
4. On your turn, tap **Roll dice**. Buy what you land on or send it to auction. Build houses from **My properties** once you own a full color set. Make deals from **Trade**.

## Project layout

```
server/index.js    Express static server, Socket.IO rooms, reconnect tokens
server/game.js     Authoritative rules engine (turns, rent, cards, jail, auctions, trades, bankruptcy)
shared/board.js    Board spaces, prices, rents, cards — shared by server and client
public/index.html  App shell (home, lobby, game screens)
public/js/board3d.js  Three.js scene: board texture, tokens, dice, houses, animations
public/js/main.js  Networking, lobby, HUD, sheets (buy, auction, trade, properties, log/chat)
test/simulate.js   Fuzz test: plays hundreds of random bot games and checks rule invariants
```

## Tests

```bash
npm test            # plays 300 random 2–6 player games against the rules engine
```

## Simplifications vs. the official rules

- There's no limit on the number of houses and hotels the bank has.
- Properties that go back to the bank after a bankruptcy aren't auctioned. They simply become available again.
- Receiving a mortgaged property in a trade or bankruptcy doesn't charge the 10% transfer fee.
- The "nearest utility" card uses the dice you just rolled instead of a new roll.
