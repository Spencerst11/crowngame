# crowngame
crowngame
# Crown Game (Family Five Crowns Table)

Private web-based table for playing the Five Crowns–style game with up to seven players across different devices.

## Features
- Password gate ("5Crown") before anyone can sit at the table.
- Rooms so the family can gather in a named party; 2–7 players supported.
- Ready-up flow to start each round, rotating wild cards per the official rules.
- Real-time play, hidden hands per player, draw/discard piles, and reshuffle when the draw pile is exhausted.
- Go-out workflow with a visible alert bubble, last-turn enforcement for the remaining players, and validation for books/runs (including jokers and rotating wilds).
- Slide-out scoreboard that tracks round totals and running sums for everyone.
- Themed table and custom suits (stars, blue diamonds, red hearts, black spades, green clubs) plus a red/white checkered card back.

## Running locally
1. Install dependencies (requires access to npm registry):
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open http://localhost:3000 in your browser. The first visitor should **create** a room code and share it with the family; everyone enters the shared password plus that room code to join from their own device.

> Note: If npm install fails due to registry access limits, add the needed packages manually to your offline cache or mirror (`express`, `socket.io`, `uuid`, `nodemon` for dev).
