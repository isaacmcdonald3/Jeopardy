export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

export interface FinalWager {
  amount: number;
  correct: boolean | null;
}

export interface GameSnapshot {
  roomCode: string;
  buzzerOpen: boolean;
  buzzOrder: string[];
  players: Player[];
  finalJeopardy: boolean;
  wagers: Record<string, FinalWager>;
  isHost: boolean;
  playerId: string | null;
}

export type RoomReply =
  | { ok: true; roomCode: string; hostKey?: string }
  | { ok: false; error: string };

export interface ClientToServerEvents {
  "room:create": (reply: (result: RoomReply) => void) => void;
  "room:join": (
    details: { roomCode: string; role: "host" | "player"; key?: string; playerId?: string; name?: string },
    reply: (result: RoomReply) => void,
  ) => void;
  "host:remove-player": (playerId: string) => void;
  "host:score": (details: { playerId: string; delta: number }) => void;
  "host:buzzer": (action: "open" | "close" | "clear") => void;
  "player:buzz": () => void;
  "host:final-jeopardy": (enabled: boolean) => void;
  "player:lock-wager": (amount: number) => void;
  "host:resolve-wager": (details: { playerId: string; correct: boolean }) => void;
  "host:times-up": () => void;
}

export interface ServerToClientEvents {
  "game:state": (state: GameSnapshot) => void;
  "game:error": (message: string) => void;
}
