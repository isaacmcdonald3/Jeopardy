# Jeopardy Night

A live, shared Jeopardy game for a host and players on their own devices. The host runs the game; players join with a room code or link.

## Run a game

1. Install Node.js 20 or newer.
2. From this folder, run `npm install`.
3. Run `npm run dev`.
4. Open the Vite URL shown in the terminal (usually `http://localhost:5173`) and choose **Host a game**.
5. Share the room code or **Copy player link** with everyone. For friends on the same Wi-Fi, share your computer's local-network address with port `5173` instead of `localhost`.

The host and player devices must be able to reach the computer running the app. The development server keeps room state in memory, so rooms end when the server stops.

## Production

Run `npm run build`, then `npm start`. The production server listens on port `3001` by default; set the `PORT` environment variable to use another port.

## Game controls

- Hosts can open, close, and clear the buzzer; the server records the buzz-in order and first player.
- Hosts can adjust scores by $100, $200, $300, or a custom amount, and remove players.
- **Time's up** closes the buzzer and plays the supplied sound.
- Final Jeopardy locks each player's wager privately. Only the player and host receive that player's wager; the host marks answers correct or incorrect to update scores.
