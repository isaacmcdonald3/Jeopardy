import express from "express";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Server } from "socket.io";
import type { ClientToServerEvents, FinalWager, GameSnapshot, Player, ServerToClientEvents } from "../src/shared";

interface Room {
  code: string;
  hostKey: string;
  hostSocketId: string | null;
  players: Map<string, Player>;
  playerSockets: Map<string, string>;
  buzzerOpen: boolean;
  buzzOrder: string[];
  finalJeopardy: boolean;
  wagers: Map<string, FinalWager>;
}

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
const rooms = new Map<string, Room>();
const port = Number(process.env.PORT ?? 3001);
const distPath = join(process.cwd(), "dist");

app.get("/healthz", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

function getRoomForSocket(socketId: string): Room | undefined {
  return [...rooms.values()].find(
    (room) => room.hostSocketId === socketId || [...room.playerSockets.values()].includes(socketId),
  );
}

function sendSnapshots(room: Room): void {
  const players = [...room.players.values()].map((player) => ({ ...player }));
  const base = {
    roomCode: room.code,
    buzzerOpen: room.buzzerOpen,
    buzzOrder: [...room.buzzOrder],
    players,
    finalJeopardy: room.finalJeopardy,
  };

  if (room.hostSocketId) {
    const snapshot: GameSnapshot = {
      ...base,
      isHost: true,
      playerId: null,
      wagers: Object.fromEntries(room.wagers),
    };
    io.to(room.hostSocketId).emit("game:state", snapshot);
  }

  for (const [playerId, socketId] of room.playerSockets) {
    const ownWager = room.wagers.get(playerId);
    const snapshot: GameSnapshot = {
      ...base,
      isHost: false,
      playerId,
      wagers: ownWager ? { [playerId]: ownWager } : {},
    };
    io.to(socketId).emit("game:state", snapshot);
  }
}

function sendError(socketId: string, message: string): void {
  io.to(socketId).emit("game:error", message);
}

io.on("connection", (socket) => {
  socket.on("room:create", (reply) => {
    let code = "";
    do {
      code = randomBytes(3).toString("hex").toUpperCase();
    } while (rooms.has(code));

    const room: Room = {
      code,
      hostKey: randomUUID(),
      hostSocketId: null,
      players: new Map(),
      playerSockets: new Map(),
      buzzerOpen: false,
      buzzOrder: [],
      finalJeopardy: false,
      wagers: new Map(),
    };
    rooms.set(code, room);
    reply({ ok: true, roomCode: code, hostKey: room.hostKey });
  });

  socket.on("room:join", (details, reply) => {
    const code = details.roomCode.trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      reply({ ok: false, error: "That room could not be found. Ask the host to start a new game." });
      return;
    }

    if (details.role === "host") {
      if (!details.key || details.key !== room.hostKey) {
        reply({ ok: false, error: "Host access could not be verified for this room." });
        return;
      }
      if (room.hostSocketId && room.hostSocketId !== socket.id) {
        io.sockets.sockets.get(room.hostSocketId)?.disconnect(true);
      }
      room.hostSocketId = socket.id;
      socket.join(code);
      reply({ ok: true, roomCode: code });
      sendSnapshots(room);
      return;
    }

    const name = details.name?.trim().replace(/\s+/g, " ").slice(0, 24) ?? "";
    const playerId = details.playerId;
    if (!name || !playerId || playerId.length > 64) {
      reply({ ok: false, error: "Enter a name to join the game." });
      return;
    }

    const previousSocketId = room.playerSockets.get(playerId);
    if (previousSocketId && previousSocketId !== socket.id) {
      io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    }
    const existing = room.players.get(playerId);
    room.players.set(playerId, {
      id: playerId,
      name,
      score: existing?.score ?? 0,
      connected: true,
    });
    room.playerSockets.set(playerId, socket.id);
    socket.join(code);
    reply({ ok: true, roomCode: code });
    sendSnapshots(room);
  });

  socket.on("host:remove-player", (playerId) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostSocketId !== socket.id || !room.players.has(playerId)) return;
    const playerSocketId = room.playerSockets.get(playerId);
    if (playerSocketId) {
      io.to(playerSocketId).emit("game:removed");
      io.sockets.sockets.get(playerSocketId)?.leave(room.code);
      room.playerSockets.delete(playerId);
    }
    room.players.delete(playerId);
    room.wagers.delete(playerId);
    room.buzzOrder = room.buzzOrder.filter((id) => id !== playerId);
    sendSnapshots(room);
  });

  socket.on("host:score", ({ playerId, delta }) => {
    const room = getRoomForSocket(socket.id);
    const player = room?.players.get(playerId);
    if (!room || room.hostSocketId !== socket.id || !player || !Number.isSafeInteger(delta) || Math.abs(delta) > 1_000_000) return;
    player.score += delta;
    sendSnapshots(room);
  });

  socket.on("host:buzzer", (action) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;
    if (action === "open") room.buzzerOpen = true;
    if (action === "close") room.buzzerOpen = false;
    if (action === "clear") room.buzzOrder = [];
    sendSnapshots(room);
  });

  socket.on("player:buzz", () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostSocketId === socket.id || !room.buzzerOpen) return;
    const playerId = [...room.playerSockets].find(([, socketId]) => socketId === socket.id)?.[0];
    if (!playerId || room.buzzOrder.includes(playerId)) return;
    room.buzzOrder.push(playerId);
    sendSnapshots(room);
  });

  socket.on("host:final-jeopardy", (enabled) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;
    room.finalJeopardy = enabled;
    room.buzzerOpen = false;
    if (enabled) {
      room.buzzOrder = [];
      room.wagers.clear();
    }
    sendSnapshots(room);
  });

  socket.on("player:lock-wager", (amount) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostSocketId === socket.id || !room.finalJeopardy || !Number.isSafeInteger(amount) || amount < 0) return;
    const playerId = [...room.playerSockets].find(([, socketId]) => socketId === socket.id)?.[0];
    const player = playerId ? room.players.get(playerId) : undefined;
    if (!playerId || !player || room.wagers.has(playerId) || amount > Math.max(0, player.score)) {
      if (playerId && room.wagers.has(playerId)) sendError(socket.id, "Your wager is already locked in.");
      return;
    }
    room.wagers.set(playerId, { amount, correct: null });
    sendSnapshots(room);
  });

  socket.on("host:resolve-wager", ({ playerId, correct }) => {
    const room = getRoomForSocket(socket.id);
    const player = room?.players.get(playerId);
    const wager = room?.wagers.get(playerId);
    if (!room || room.hostSocketId !== socket.id || !player || !wager || wager.correct !== null) return;
    wager.correct = correct;
    player.score += correct ? wager.amount : -wager.amount;
    sendSnapshots(room);
  });

  socket.on("host:times-up", () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;
    room.buzzerOpen = false;
    sendSnapshots(room);
  });

  socket.on("disconnect", () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    if (room.hostSocketId === socket.id) {
      room.hostSocketId = null;
    } else {
      const entry = [...room.playerSockets].find(([, socketId]) => socketId === socket.id);
      if (entry) {
        room.playerSockets.delete(entry[0]);
        const player = room.players.get(entry[0]);
        if (player) player.connected = false;
      }
    }
    sendSnapshots(room);
  });
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((_request, response) => response.sendFile(join(distPath, "index.html")));
}

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Jeopardy Night server listening on http://localhost:${port}`);
});
