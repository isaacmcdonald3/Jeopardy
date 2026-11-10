# Jeopardy Night

A live, shared Jeopardy game for a host and players on their own devices. The host runs the game; players join with a room code or link.

## Run a game

1. Install Node.js 20 or newer.
2. From this folder, run `npm install`.
3. Run `npm run dev`.
4. Open the Vite URL shown in the terminal (usually `http://localhost:5173`) and choose **Host a game**. Do not open `index.html` with VS Code Live Server: Live Server does not compile the React/TypeScript source or start the multiplayer server.
5. Share the room code or **Copy player link** with everyone. For friends on the same Wi-Fi, share your computer's local-network address with port `5173` instead of `localhost`.

The host and player devices must be able to reach the computer running the app. The development server keeps room state in memory, so rooms end when the server stops.

## Deploy to Render

This project includes a [`render.yaml`](./render.yaml) Blueprint for a free **Web Service**. Push the project to a GitHub repository, then in Render choose **New → Blueprint**, select that repository, and deploy. The Blueprint installs dependencies, builds the frontend, starts the app, and checks `/healthz`. You can also create a Web Service manually with build command `npm ci && npm run build` and start command `npm start`.

Use a Web Service, not a Static Site: the app needs a Node server and Socket.IO WebSocket connections for multiplayer. Render supplies the port through `PORT`, and the server serves the built frontend and game from the same origin.

Render's free service may spin down after inactivity. This app keeps rooms and scores in server memory, so stopping or restarting the service ends every active game. Start a fresh room after the service wakes up. Use the same deployed URL for the host and all players.

For local production testing, run `npm run build`, then `npm start`. The server listens on port `3001` by default.

## Game controls

- Hosts can open, close, and clear the buzzer; the server records the buzz-in order and first player.
- Hosts can adjust scores by $100, $200, $300, or a custom amount, and remove players.
- **Time's up** closes the buzzer and plays the supplied sound.
- Final Jeopardy locks each player's wager privately. Only the player and host receive that player's wager; the host marks answers correct or incorrect to update scores.
