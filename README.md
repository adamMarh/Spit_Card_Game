# Speed (Vitesse)

Real-time two-player Speed card game with anonymous lobby codes, an authoritative in-memory server, and a Vite React client.

## Stack

- Client: React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Zustand, native Pointer Events
- Server: Node.js, TypeScript, `uWebSockets.js`, in-memory `Map<lobbyId, GameRoom>`
- Shared: TypeScript protocol/card types imported by both apps

## Important Node Version Note

`uWebSockets.js` is a native package. The pinned release used here supports Node 18, 20, 22, and 23, but not Node 24.

If your terminal shows Node 24, run the backend with Docker or switch to Node 22 before using `npm run dev --workspace server`.

```bash
node -v
nvm install 22
nvm use 22
```

## Install

From the repo root:

```bash
npm install
npm run build --workspace shared
```

## Open The Server

### Option A: Local Node

Use this when `node -v` is Node 18, 20, 22, or 23.

```bash
npm run dev --workspace server
```

The backend listens on:

```text
ws://localhost:8080
```

Check that it is alive:

```bash
curl http://localhost:8080/health
```

Expected response:

```text
ok
```

### Option B: Docker Backend

Use this when your host Node is Node 24 or when you want to match the Fly.io container runtime.

```bash
docker compose up --build server
```

The backend still listens on:

```text
ws://localhost:8080
```

## Open The Frontend Client

In a second terminal, from the repo root:

```bash
VITE_WS_URL=ws://localhost:8080 npm run dev --workspace client
```

Open the app in your browser:

```text
http://localhost:5173
```

To test a two-player game locally, open that same URL in two browser windows or two tabs.

## Run Both With Docker Compose

```bash
docker compose up --build
```

Then open:

```text
http://localhost:5173
```

## How To Play

1. Open `http://localhost:5173` in the first browser window.
2. Enter your player name.
3. Click `Create Lobby`.
4. Copy the 5-character lobby code shown on screen.
5. Open `http://localhost:5173` in a second browser window.
6. Enter the second player name.
7. Enter the lobby code and click `Join`.
8. The center lobby panel shows both player names and whether each player is ready or still waiting.
9. Both players click `Ready`. Your Ready button turns grey once your ready signal is accepted.
10. After the countdown, drag cards from your bottom hand onto either center battle pile.
11. A card is legal if its rank is exactly one higher or one lower than the pile top. Suits do not matter.
12. Ace wraps: `A` works with both `2` and `K`.
13. The server validates every drop. If a move is illegal or misses a pile, the card returns to your hand.
14. Your hand refills automatically from your stock until you have 5 cards or your stock is empty.
15. If both players have no legal moves, the server flips fresh spit cards automatically. If the spit cards are exhausted, it reshuffles battle discards while preserving the top cards.
16. The first player with both empty hand and empty stock wins immediately.
17. A player can click `Quit` at any time. Before the game starts, nobody wins. During the game, the player who stays is declared the winner.

Opponent cursor and drag motion are cosmetic real-time sync. The opponent sits across the table, so their movement is mirrored and shown from the upper side of your screen.

## Testing Rules And Builds

Run unit tests for the pure game engine:

```bash
npm test
```

The tests cover:

- legal and illegal rank validation, including ace-low behavior
- stock-to-hand refill
- deadlock detection and center-card recovery
- immediate win on the final valid move
- exact initial deal counts: 6 + 6 center cards, 15 + 15 stock cards, 5 + 5 hand cards

Run the full production build:

```bash
npm run build
```

## Deployment

### Fly.io Backend

```bash
cd server
fly launch
fly deploy
```

Set `PORT=8080` if your Fly app does not inject it. Set `CLIENT_ORIGIN` to your frontend origin for the health endpoint CORS header.

All lobby and game state is in memory, so deploy the backend as a single machine/process if players need to reconnect to existing lobbies.

### Vercel/Netlify Frontend

Build command:

```bash
npm install && npm run build --workspace shared && npm run build --workspace client
```

Publish directory:

```bash
client/dist
```

Environment variable:

```bash
VITE_WS_URL=wss://your-fly-app.fly.dev
```

## Protocol

Client messages: `create_lobby`, `join_lobby`, `ready`, `play_card`, `cursor_move`.

Server messages: `lobby_created`, `state_update`, `game_over`, `opponent_cursor`, `toast`, `error`.

The server is authoritative for cards, stocks, piles, legal moves, deadlock recovery, and wins. Cursor messages are cosmetic only and are relayed directly to the opponent.
