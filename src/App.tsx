import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, GameSnapshot, RoomReply, ServerToClientEvents } from "./shared";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Screen = "home" | "host" | "player";

const socket: GameSocket = io({ autoConnect: false });
const initialRoom = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";

function formatScore(score: number): string {
  return `${score < 0 ? "−" : ""}$${Math.abs(score).toLocaleString()}`;
}

function getPlayerId(): string {
  const stored = sessionStorage.getItem("jeopardy-player-id");
  if (stored) return stored;
  const id = crypto.randomUUID();
  sessionStorage.setItem("jeopardy-player-id", id);
  return id;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [roomCode, setRoomCode] = useState(initialRoom);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [customPoints, setCustomPoints] = useState("");
  const [wagerInput, setWagerInput] = useState("");
  const soundRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      setJoined(false);
      setScreen("home");
    };
    const onState = (state: GameSnapshot) => {
      setSnapshot(state);
      setScreen(state.isHost ? "host" : "player");
      setJoined(true);
      setRoomCode(state.roomCode);
      setSelectedPlayerId((current) =>
        state.players.some((player) => player.id === current) ? current : state.players[0]?.id ?? "",
      );
    };
    const onError = (message: string) => setNotice(message);
    const onRemoved = () => {
      sessionStorage.removeItem("jeopardy-player-room");
      sessionStorage.removeItem("jeopardy-player-name");
      setSnapshot(null);
      setJoined(false);
      setScreen("home");
      setNotice("The host removed you from the game.");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("game:state", onState);
    socket.on("game:error", onError);
    socket.on("game:removed", onRemoved);
    socket.connect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("game:state", onState);
      socket.off("game:error", onError);
      socket.off("game:removed", onRemoved);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (screen !== "home" || !socket.connected) return;
    const hostCode = sessionStorage.getItem("jeopardy-host-room");
    const hostKey = sessionStorage.getItem("jeopardy-host-key");
    if (hostCode && hostKey) {
      socket.emit("room:join", { roomCode: hostCode, role: "host", key: hostKey }, (result) => {
        if (!result.ok) {
          sessionStorage.removeItem("jeopardy-host-room");
          sessionStorage.removeItem("jeopardy-host-key");
          setError(result.error);
        }
      });
      return;
    }
    const playerCode = sessionStorage.getItem("jeopardy-player-room");
    const playerName = sessionStorage.getItem("jeopardy-player-name");
    if (playerCode && playerName) {
      socket.emit(
        "room:join",
        { roomCode: playerCode, role: "player", playerId: getPlayerId(), name: playerName },
        (result) => {
          if (!result.ok) {
            sessionStorage.removeItem("jeopardy-player-room");
            sessionStorage.removeItem("jeopardy-player-name");
            setNotice(result.error);
          }
        },
      );
    }
  }, [screen, connected]);

  const players = snapshot?.players ?? [];
  const ownPlayer = useMemo(
    () => players.find((player) => player.id === snapshot?.playerId),
    [players, snapshot?.playerId],
  );
  const firstBuzz = players.find((player) => player.id === snapshot?.buzzOrder[0]);
  const isLocked = Boolean(snapshot?.playerId && snapshot.wagers[snapshot.playerId]);

  function enterRoom(role: "host" | "player") {
    setError("");
    setNotice("");
    if (!socket.connected) {
      setError("Connecting to the game server… Please try again in a moment.");
      return;
    }
    if (role === "host") {
      socket.emit("room:create", (created) => {
        if (!created.ok || !created.hostKey) {
          setError(created.ok ? "The host room could not be created." : created.error);
          return;
        }
        sessionStorage.setItem("jeopardy-host-room", created.roomCode);
        sessionStorage.setItem("jeopardy-host-key", created.hostKey);
        socket.emit("room:join", { roomCode: created.roomCode, role: "host", key: created.hostKey }, (joinedRoom) => {
          if (!joinedRoom.ok) setError(joinedRoom.error);
        });
      });
      return;
    }
    const playerId = getPlayerId();
    socket.emit(
      "room:join",
      { roomCode, role: "player", playerId, name },
      (result: RoomReply) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        sessionStorage.setItem("jeopardy-player-room", roomCode);
        sessionStorage.setItem("jeopardy-player-name", name.trim());
      },
    );
  }

  function sendScore(delta: number) {
    if (!selectedPlayerId) return;
    socket.emit("host:score", { playerId: selectedPlayerId, delta });
    setCustomPoints("");
  }

  async function timesUp() {
    socket.emit("host:times-up");
    const audio = soundRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    try {
      await audio.play();
    } catch {
      setNotice("The buzzer was closed, but the sound could not be played. Check your device audio settings.");
    }
  }

  if (joined && snapshot) {
    return screen === "host" ? (
      <main className="game-shell host-shell">
        <audio ref={soundRef} src="/sounds/times-up.m4a" preload="auto" />
        <GameTopbar roomCode={snapshot.roomCode} role="HOST" />
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>Dismiss</button></div>}
        <div className="host-layout">
          <section className="main-column">
            <section className="panel buzzer-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">THE PODIUM</p><h2>Buzzer control</h2></div>
                <span className={`status-pill ${snapshot.buzzerOpen ? "status-open" : ""}`}><span />{snapshot.buzzerOpen ? "BUZZER OPEN" : "BUZZER CLOSED"}</span>
              </div>
              <div className="control-row">
                <button className="button button-green" onClick={() => socket.emit("host:buzzer", "open")} disabled={snapshot.buzzerOpen}>Open buzzer</button>
                <button className="button button-muted" onClick={() => socket.emit("host:buzzer", "close")} disabled={!snapshot.buzzerOpen}>Close buzzer</button>
                <button className="button button-outline" onClick={() => socket.emit("host:buzzer", "clear")} disabled={snapshot.buzzOrder.length === 0}>Clear queue</button>
                <button className="button button-red times-button" onClick={timesUp}>Time’s up <span aria-hidden="true">▶</span></button>
              </div>
              <div className="buzz-display">
                {firstBuzz ? <><div className="first-buzz-label"><span className="live-dot" /> FIRST TO BUZZ</div><div className="first-buzz-name">{firstBuzz.name}</div></> : <div className="empty-buzz">Waiting for the first buzz-in</div>}
                <div className="queue-strip"><span>BUZZ QUEUE</span>{snapshot.buzzOrder.length ? snapshot.buzzOrder.map((id, index) => <span className="queue-chip" key={id}><b>{index + 1}</b>{players.find((player) => player.id === id)?.name ?? "Player"}</span>) : <span className="queue-empty">No one has buzzed in yet</span>}</div>
              </div>
            </section>

            {snapshot.finalJeopardy && (
              <section className="panel final-panel">
                <div className="panel-heading"><div><p className="eyebrow">FINAL ROUND</p><h2>Final Jeopardy</h2></div><span className="status-pill status-final"><span /> IN PROGRESS</span></div>
                <p className="panel-copy">Wagers are private until the host. Review each locked wager and score the response.</p>
                <div className="final-table">
                  {players.map((player) => {
                    const wager = snapshot.wagers[player.id];
                    return <div className="final-row" key={player.id}>
                      <div className="final-player"><span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span><div><strong>{player.name}</strong><small>{formatScore(player.score)}</small></div></div>
                      <div className="wager-cell">{wager ? <><strong>{formatScore(wager.amount)}</strong><small>{wager.correct === null ? "Locked in" : wager.correct ? "Correct" : "Incorrect"}</small></> : <span className="waiting-wager">Waiting for wager</span>}</div>
                      {wager && wager.correct === null ? <div className="result-actions"><button className="button button-green button-small" onClick={() => socket.emit("host:resolve-wager", { playerId: player.id, correct: true })}>Correct</button><button className="button button-red button-small" onClick={() => socket.emit("host:resolve-wager", { playerId: player.id, correct: false })}>Incorrect</button></div> : <div className="result-actions result-placeholder">{wager ? "Scored" : "—"}</div>}
                    </div>;
                  })}
                  {!players.length && <div className="no-players">Players will appear here when they join.</div>}
                </div>
                <button className="button button-outline final-end" onClick={() => socket.emit("host:final-jeopardy", false)}>End Final Jeopardy</button>
              </section>
            )}

            <section className="panel players-panel">
              <div className="panel-heading"><div><p className="eyebrow">THE CONTESTANTS</p><h2>Players <span className="count-badge">{players.length}</span></h2></div><span className="live-caption"><span className="live-dot" /> LIVE SCORES</span></div>
              <div className="players-list">
                {players.map((player, index) => <div className={`player-row ${selectedPlayerId === player.id ? "player-row-selected" : ""}`} key={player.id}>
                  <button className="player-select" onClick={() => setSelectedPlayerId(player.id)} aria-label={`Adjust ${player.name}'s score`}>
                    <span className="rank">{String(index + 1).padStart(2, "0")}</span><span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span><span className="player-name-wrap"><strong>{player.name}</strong><small><span className={`connection-dot ${player.connected ? "is-connected" : ""}`} />{player.connected ? "In the game" : "Disconnected"}</small></span><strong className="score">{formatScore(player.score)}</strong>
                  </button>
                  <button className="remove-player" aria-label={`Remove ${player.name}`} title={`Remove ${player.name}`} onClick={() => { if (window.confirm(`Remove ${player.name} from the game?`)) socket.emit("host:remove-player", player.id); }}>×</button>
                </div>)}
                {!players.length && <div className="empty-players"><span>♧</span><strong>Your podium is ready</strong><small>Share the room code so your players can join.</small></div>}
              </div>
              {players.length > 0 && <ScoreControls customPoints={customPoints} setCustomPoints={setCustomPoints} selectedPlayer={players.find((player) => player.id === selectedPlayerId)} onScore={sendScore} />}
            </section>
          </section>

          <aside className="side-column">
            <section className="room-card">
              <p className="eyebrow">YOUR GAME ROOM</p><div className="room-code">{snapshot.roomCode}</div><p className="room-hint">Share this code with your players</p>
              <button className="share-link" onClick={async () => { const url = `${window.location.origin}/?room=${snapshot.roomCode}`; try { await navigator.clipboard.writeText(url); setNotice("Join link copied to clipboard."); } catch { setNotice(`Share this join link: ${url}`); } }}><span>↗</span> Copy player link</button>
            </section>
            <section className="panel round-card"><p className="eyebrow">GAME TOOLS</p><h3>Final Jeopardy</h3><p className="panel-copy">Lock private wagers, then score each player’s answer.</p><button className={`button ${snapshot.finalJeopardy ? "button-muted" : "button-gold"} full-button`} onClick={() => socket.emit("host:final-jeopardy", !snapshot.finalJeopardy)}>{snapshot.finalJeopardy ? "Final Jeopardy is live" : "Start Final Jeopardy"}</button></section>
            <section className="host-tip"><span>✦</span><p><strong>Host tip</strong>Open the buzzer when your clue is read. The queue keeps every buzz-in in order.</p></section>
            <div className="secure-note"><span>●</span> Only you can see and score wagers.</div>
          </aside>
        </div>
        <footer className="footer">JEOPARDY NIGHT <span>•</span> HOST CONTROLS</footer>
      </main>
    ) : (
      <main className="game-shell player-shell">
        <GameTopbar roomCode={snapshot.roomCode} role="PLAYER" />
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>Dismiss</button></div>}
        {ownPlayer && <div className="player-welcome"><div><p className="eyebrow">WELCOME TO THE PODIUM</p><h1>{ownPlayer.name}<span>’s game</span></h1></div><div className="my-score-card"><span>YOUR SCORE</span><strong>{formatScore(ownPlayer.score)}</strong></div></div>}
        {snapshot.finalJeopardy ? (
          <section className="panel player-final">
            <div className="panel-heading"><div><p className="eyebrow">THE FINAL ROUND</p><h2>Final Jeopardy</h2></div><span className="status-pill status-final"><span /> IN PROGRESS</span></div>
            <p className="panel-copy">Everyone’s scores are on the board. Choose your wager privately; only you and the host can see it.</p>
            <div className="scoreboard">{players.map((player) => <div className={`scoreboard-item ${player.id === snapshot.playerId ? "scoreboard-mine" : ""}`} key={player.id}><span>{player.name}{player.id === snapshot.playerId && <small> YOU</small>}</span><strong>{formatScore(player.score)}</strong></div>)}</div>
            <div className="wager-box">{isLocked ? <><div className="locked-icon">✓</div><p className="eyebrow">WAGER LOCKED</p><div className="locked-amount">{formatScore(snapshot.wagers[snapshot.playerId!].amount)}</div><p className="panel-copy">Your wager is locked in. Good luck!</p></> : <><label className="eyebrow" htmlFor="wager">YOUR PRIVATE WAGER</label><div className="wager-input-wrap"><span>$</span><input id="wager" type="number" min="0" max={Math.max(0, ownPlayer?.score ?? 0)} step="1" value={wagerInput} onChange={(event) => setWagerInput(event.target.value)} placeholder="Enter your wager" /><button className="button button-gold" disabled={!wagerInput || !Number.isSafeInteger(Number(wagerInput)) || Number(wagerInput) < 0 || Number(wagerInput) > Math.max(0, ownPlayer?.score ?? 0)} onClick={() => socket.emit("player:lock-wager", Number(wagerInput))}>Lock wager</button></div><small className="wager-limit">Wager up to {formatScore(Math.max(0, ownPlayer?.score ?? 0))}</small></>}</div>
          </section>
        ) : (
          <section className="player-buzzer-area">
            <div className="player-status"><span className={`status-pill ${snapshot.buzzerOpen ? "status-open" : ""}`}><span />{snapshot.buzzerOpen ? "BUZZER OPEN" : "BUZZER CLOSED"}</span><p>{snapshot.buzzerOpen ? "Know the answer? Be quick!" : "The host will open the buzzer when the clue is ready."}</p></div>
            <button className={`big-buzzer ${snapshot.buzzerOpen && !snapshot.buzzOrder.includes(snapshot.playerId ?? "") ? "big-buzzer-active" : ""}`} disabled={!snapshot.buzzerOpen || snapshot.buzzOrder.includes(snapshot.playerId ?? "")} onClick={() => socket.emit("player:buzz")}><span className="buzzer-ring"><span className="buzzer-core"><span>BUZZ</span><small>IN</small></span></span><span className="buzzer-caption">{snapshot.buzzOrder.includes(snapshot.playerId ?? "") ? "YOU’RE IN THE QUEUE" : snapshot.buzzerOpen ? "TAP TO BUZZ IN" : "WAIT FOR THE HOST"}</span></button>
            {snapshot.buzzOrder.includes(snapshot.playerId ?? "") && <div className="you-buzzed">You’re #{snapshot.buzzOrder.indexOf(snapshot.playerId ?? "") + 1} in the queue{snapshot.buzzOrder[0] === snapshot.playerId ? " — first up!" : ""}</div>}
            {firstBuzz && <div className="player-first"><span className="live-dot" /> FIRST TO BUZZ <strong>{firstBuzz.name}</strong></div>}
          </section>
        )}
        {!snapshot.finalJeopardy && <section className="panel scoreboard-panel"><div className="panel-heading"><div><p className="eyebrow">THE CONTESTANTS</p><h2>Scoreboard</h2></div><span className="live-caption"><span className="live-dot" /> LIVE</span></div><div className="scoreboard">{players.map((player) => <div className={`scoreboard-item ${player.id === snapshot.playerId ? "scoreboard-mine" : ""}`} key={player.id}><span>{player.name}{player.id === snapshot.playerId && <small> YOU</small>}</span><strong>{formatScore(player.score)}</strong></div>)}</div></section>}
        <footer className="footer">JEOPARDY NIGHT <span>•</span> GOOD LUCK</footer>
      </main>
    );
  }

  return <main className="landing">
    <div className="landing-glow" />
    <header className="landing-header"><a className="brand" href="/"><span className="brand-mark">J!</span><span>JEOPARDY <b>NIGHT</b></span></a><span className="network-status"><i className={connected ? "online" : ""} />{connected ? "GAME SERVER READY" : "CONNECTING TO GAME"}</span></header>
    <section className="hero"><p className="eyebrow"><span className="eyebrow-line" /> A LITTLE FRIENDLY COMPETITION <span className="eyebrow-line" /></p><h1>Make it a<br /><em>game night.</em></h1><p className="hero-copy">Bring your people together for a Jeopardy game night.<br className="desktop-break" /> One host. Your own podium. All the bragging rights.</p></section>
    <section className="entry-cards">
      <form className={`entry-card ${initialRoom ? "join-card-highlight" : ""}`} onSubmit={(event) => { event.preventDefault(); enterRoom("player"); }}>
        <div className="card-icon join-icon">↗</div><p className="eyebrow">HERE TO PLAY?</p><h2>Join the game</h2><p className="card-copy">Enter your host’s room code and pick your podium name.</p><label htmlFor="room-code">ROOM CODE</label><input id="room-code" className="room-input" maxLength={6} value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="e.g. 4K7P2M" autoComplete="off" /><label htmlFor="player-name">YOUR NAME</label><input id="player-name" className="room-input" maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="What should we call you?" autoComplete="nickname" /><button className="button button-gold full-button" type="submit" disabled={!roomCode.trim() || !name.trim()}>Take your seat <span>→</span></button>
      </form>
      <div className="entry-card host-entry"><div className="card-icon host-icon">✦</div><p className="eyebrow">RUNNING THE SHOW?</p><h2>Host a game</h2><p className="card-copy">Create a room, share the code, and take your place at the podium.</p><div className="host-features"><span><i>✓</i> Live buzzer &amp; scorekeeping</span><span><i>✓</i> Private Final Jeopardy wagers</span><span><i>✓</i> Everyone joins on their own device</span></div><button className="button button-outline full-button" onClick={() => enterRoom("host")}>Create a host room <span>→</span></button></div>
    </section>
    {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>Dismiss</button></div>}
    {error && <div className="error-message" role="alert">{error}</div>}
    <footer className="landing-footer"><span>MADE FOR GAME NIGHT</span><span>THE ANSWER IS... <b>GOOD TIMES.</b></span></footer>
  </main>;
}

function GameTopbar({ roomCode, role }: { roomCode: string; role: "HOST" | "PLAYER" }) {
  return <header className="game-topbar"><a className="brand" href="/"><span className="brand-mark">J!</span><span>JEOPARDY <b>NIGHT</b></span></a><div className="game-top-meta"><span className="role-label">{role}</span><span className="top-room-code">{roomCode}</span><span className="network-status"><i className="online" /> LIVE</span></div></header>;
}

function ScoreControls({ customPoints, setCustomPoints, selectedPlayer, onScore }: {
  customPoints: string;
  setCustomPoints: (value: string) => void;
  selectedPlayer?: { name: string } | undefined;
  onScore: (delta: number) => void;
}) {
  return <div className="score-controls"><div className="score-control-heading"><div><p className="eyebrow">SCOREKEEPING</p><strong>{selectedPlayer ? `Adjust ${selectedPlayer.name}’s score` : "Select a player to adjust points"}</strong></div><span>DAILY DOUBLE? SET A CUSTOM AMOUNT</span></div><div className="score-actions">{[100, 200, 300].map((points) => <div className="score-step" key={points}><button disabled={!selectedPlayer} onClick={() => onScore(points)}>+${points}</button><button disabled={!selectedPlayer} onClick={() => onScore(-points)}>−${points}</button></div>)}<div className="custom-step"><div className="custom-input"><span>$</span><input aria-label="Custom point amount" type="number" min="1" max="1000000" step="1" value={customPoints} onChange={(event) => setCustomPoints(event.target.value)} placeholder="Custom" /></div><button className="custom-add" disabled={!selectedPlayer || !customPoints || !Number.isSafeInteger(Number(customPoints)) || Number(customPoints) <= 0 || Number(customPoints) > 1_000_000} onClick={() => onScore(Number(customPoints))}>+ Add</button><button className="custom-subtract" disabled={!selectedPlayer || !customPoints || !Number.isSafeInteger(Number(customPoints)) || Number(customPoints) <= 0 || Number(customPoints) > 1_000_000} onClick={() => onScore(-Number(customPoints))}>− Deduct</button></div></div></div>;
}
