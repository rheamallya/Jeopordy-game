const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { GameManager, normalizeBoard, VOTE_PHASE_DEFAULT_TIME, BUZZER_ANSWER_TIME } = require("./gameManager");

const PORT = process.env.PORT || 3001;
const BOARDS_DIR = path.join(__dirname, "boards");
if (!fs.existsSync(BOARDS_DIR)) fs.mkdirSync(BOARDS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function safeBoardFilename(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === "IPv4" && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

app.get("/api/info", (req, res) => {
  res.json({ lanAddresses: lanAddresses() });
});

app.get("/api/boards", (req, res) => {
  const files = fs.readdirSync(BOARDS_DIR).filter((f) => f.endsWith(".json"));
  const boards = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, f), "utf-8"));
      boards.push({ file: f, title: data.title || f });
    } catch {
      // skip unreadable board files
    }
  }
  res.json(boards);
});

app.get("/api/boards/:file", (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(BOARDS_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "Not found" });
  res.json(JSON.parse(fs.readFileSync(full, "utf-8")));
});

app.post("/api/boards", (req, res) => {
  const board = normalizeBoard(req.body);
  if (!board) return res.status(400).json({ error: "Board needs at least one category with a question." });
  const base = safeBoardFilename(board.title) || "board";
  // Overwrite when the client says which file it was editing; otherwise pick a fresh name.
  let file = req.body.file ? path.basename(String(req.body.file)) : null;
  if (!file || !file.endsWith(".json")) {
    file = `${base}.json`;
    let n = 2;
    while (fs.existsSync(path.join(BOARDS_DIR, file))) {
      file = `${base}-${n}.json`;
      n += 1;
    }
  }
  fs.writeFileSync(path.join(BOARDS_DIR, file), JSON.stringify(board, null, 2));
  res.json({ ok: true, file });
});

const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("/*splat", (req, res) => {
  const index = path.join(clientDist, "index.html");
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send("Client not built. Run `npm run build` in /client, or use the Vite dev server.");
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const manager = new GameManager();

function unitName(game, unitId) {
  return game.units.get(unitId)?.name || "Unknown";
}

function hostSnapshot(game) {
  const cur = game.current;
  return {
    serverNow: Date.now(),
    phase: game.phase,
    code: game.code,
    board: game.getBoardView(),
    lobby: game.getLobbyState(),
    current: cur
      ? {
          ...game.clientQuestionView(),
          answer: cur.answer,
          acceptedAnswers: cur.acceptedAnswers,
          submissions: [...cur.submissions.entries()].map(([unitId, s]) => ({
            unitId,
            unitName: unitName(game, unitId),
            text: s.text,
          })),
          totalUnits: game.units.size,
          reviewResults: cur.reviewResults || null,
          voteOptions: cur.voteOptions
            ? cur.voteOptions.map((o) => ({ ...o, unitName: unitName(game, o.unitId) }))
            : null,
          votesCount: cur.votes ? cur.votes.size : 0,
          buzzerAnswer: cur.buzzerAnswer || null,
          lockedUnitName: cur.lockedUnitId ? unitName(game, cur.lockedUnitId) : null,
          finalResults: cur.finalResults || null,
        }
      : null,
  };
}

function playerSnapshot(game, player) {
  const cur = game.current;
  const unitId = player.unitId;
  const myOption = cur?.voteOptions?.find((o) => o.unitId === unitId) || null;
  const myVoteId = unitId && cur?.votes ? cur.votes.get(unitId) || null : null;
  return {
    serverNow: Date.now(),
    phase: game.phase,
    code: game.code,
    me: { playerId: player.id, name: player.name, unitId },
    board: game.getBoardView(),
    lobby: game.getLobbyState(),
    current: cur
      ? {
          ...game.clientQuestionView(),
          submittedCount: cur.submissions.size,
          totalUnits: game.units.size,
          mySubmission: unitId ? cur.submissions.get(unitId)?.text ?? null : null,
          voteOptions: cur.voteOptions ? cur.voteOptions.map((o) => ({ id: o.id, label: o.label, text: o.text })) : null,
          myOptionId: myOption?.id || null,
          myVoteId,
          votesCount: cur.votes ? cur.votes.size : 0,
          buzzerAnswer: cur.buzzerAnswer || null,
          lockedUnitName: cur.lockedUnitId ? unitName(game, cur.lockedUnitId) : null,
          // Only reveal the correct answer once the question is over.
          answer: cur.stage === "results" ? cur.answer : null,
          finalResults: cur.finalResults || null,
        }
      : null,
  };
}

function emitState(game) {
  if (game.hostSocketId) io.to(game.hostSocketId).emit("host:state", hostSnapshot(game));
  for (const player of game.players.values()) {
    if (player.socketId) io.to(player.socketId).emit("player:state", playerSnapshot(game, player));
  }
}

function scheduleTimer(game, ms, fn) {
  game.clearTimer();
  if (game.current) game.current.timer = setTimeout(fn, Math.max(0, ms));
}

function doCloseMatch(game) {
  if (!game.current || game.current.mode !== "match" || game.current.stage !== "collecting") return;
  game.closeMatchSubmissions();
  emitState(game);
}

function doCloseVoteSubmissions(game) {
  if (!game.current || game.current.mode !== "vote" || game.current.stage !== "collecting") return;
  game.closeVoteSubmissions();
  emitState(game);
  scheduleTimer(game, VOTE_PHASE_DEFAULT_TIME * 1000, () => doCloseVoting(game));
}

function doCloseVoting(game) {
  if (!game.current || game.current.mode !== "vote" || game.current.stage !== "voting") return;
  game.closeVoting();
  emitState(game);
}

function doBuzzerTimeout(game, unitId) {
  const c = game.current;
  if (!c || c.mode !== "buzzer" || c.stage !== "answering" || c.lockedUnitId !== unitId) return;
  if (c.buzzerAnswer) return; // they answered in time; host decides
  game.judgeBuzzer(false);
  emitState(game);
}

io.on("connection", (socket) => {
  const hostGame = () => {
    const game = manager.get(socket.data.code);
    return game && socket.data.role === "host" && game.hostSocketId === socket.id ? game : null;
  };
  const playerCtx = () => {
    const game = manager.get(socket.data.code);
    const player = game?.players.get(socket.data.playerId);
    return game && player ? { game, player } : null;
  };

  // ---- host events ----

  socket.on("host:createGame", (board, cb) => {
    try {
      const game = manager.createGame(board, socket.id);
      socket.data.code = game.code;
      socket.data.role = "host";
      cb({ ok: true, code: game.code });
      emitState(game);
    } catch {
      cb({ ok: false, error: "Board needs at least one category with a question." });
    }
  });

  socket.on("host:rejoin", (code, cb) => {
    const game = manager.get(code);
    if (!game) return cb({ ok: false, error: "Game not found." });
    game.hostSocketId = socket.id;
    socket.data.code = game.code;
    socket.data.role = "host";
    cb({ ok: true, code: game.code });
    emitState(game);
  });

  socket.on("host:startGame", (_, cb) => {
    const game = hostGame();
    if (!game) return cb?.({ ok: false });
    if (game.units.size === 0) return cb?.({ ok: false, error: "Wait for at least one player to pick solo or team." });
    game.startGame();
    emitState(game);
    cb?.({ ok: true });
  });

  socket.on("host:reveal", (questionId, cb) => {
    const game = hostGame();
    if (!game || game.phase !== "board") return cb?.({ ok: false });
    const current = game.revealQuestion(questionId);
    if (!current) return cb?.({ ok: false, error: "Question unavailable." });
    if (current.mode === "match") {
      scheduleTimer(game, current.deadline - Date.now(), () => doCloseMatch(game));
    } else if (current.mode === "vote") {
      scheduleTimer(game, current.deadline - Date.now(), () => doCloseVoteSubmissions(game));
    }
    emitState(game);
    cb?.({ ok: true });
  });

  socket.on("host:endSubmissions", (_, cb) => {
    const game = hostGame();
    if (!game || !game.current) return cb?.({ ok: false });
    if (game.current.mode === "match") doCloseMatch(game);
    else if (game.current.mode === "vote") doCloseVoteSubmissions(game);
    cb?.({ ok: true });
  });

  socket.on("host:finalizeMatch", (overrides, cb) => {
    const game = hostGame();
    if (!game || game.current?.stage !== "review") return cb?.({ ok: false });
    game.finalizeMatch(overrides || {});
    emitState(game);
    cb?.({ ok: true });
  });

  socket.on("host:endVoting", (_, cb) => {
    const game = hostGame();
    if (!game || !game.current) return cb?.({ ok: false });
    doCloseVoting(game);
    cb?.({ ok: true });
  });

  socket.on("host:judgeBuzzer", (correct, cb) => {
    const game = hostGame();
    if (!game || !game.current) return cb?.({ ok: false });
    game.judgeBuzzer(!!correct);
    emitState(game);
    cb?.({ ok: true });
  });

  socket.on("host:backToBoard", (_, cb) => {
    const game = hostGame();
    if (!game) return cb?.({ ok: false });
    game.backToBoard();
    emitState(game);
    cb?.({ ok: true });
  });

  socket.on("host:adjustScore", ({ unitId, delta }, cb) => {
    const game = hostGame();
    if (!game) return cb?.({ ok: false });
    const ok = game.adjustScore(unitId, delta);
    if (ok) emitState(game);
    cb?.({ ok });
  });

  socket.on("host:endGame", (_, cb) => {
    const game = hostGame();
    if (!game) return cb?.({ ok: false });
    game.endGame();
    emitState(game);
    cb?.({ ok: true });
  });

  // ---- player events ----

  socket.on("player:join", ({ code, name }, cb) => {
    const game = manager.get(code);
    if (!game) return cb({ ok: false, error: "Game code not found." });
    const cleanName = String(name || "").trim().slice(0, 20);
    if (!cleanName) return cb({ ok: false, error: "Enter a name." });
    if (game.findRejoinablePlayer(cleanName)) return cb({ ok: false, error: "That name is taken in this game." });
    const playerId = game.addPlayer(cleanName, socket.id);
    socket.data.code = game.code;
    socket.data.role = "player";
    socket.data.playerId = playerId;
    cb({ ok: true, playerId, code: game.code });
    emitState(game);
  });

  socket.on("player:rejoin", ({ code, playerId }, cb) => {
    const game = manager.get(code);
    if (!game) return cb({ ok: false, error: "Game not found." });
    const player = game.reattachPlayer(playerId, socket.id);
    if (!player) return cb({ ok: false, error: "Player not found." });
    socket.data.code = game.code;
    socket.data.role = "player";
    socket.data.playerId = playerId;
    cb({ ok: true, code: game.code });
    emitState(game);
  });

  socket.on("player:chooseSolo", (_, cb) => {
    const ctx = playerCtx();
    if (!ctx) return cb?.({ ok: false });
    const unit = ctx.game.chooseSolo(ctx.player.id);
    if (!unit) return cb?.({ ok: false, error: "Already chose a mode." });
    cb?.({ ok: true });
    emitState(ctx.game);
  });

  socket.on("player:chooseTeam", (teamName, cb) => {
    const ctx = playerCtx();
    if (!ctx) return cb?.({ ok: false });
    if (!String(teamName || "").trim()) return cb?.({ ok: false, error: "Enter a team name." });
    const unit = ctx.game.chooseTeam(ctx.player.id, String(teamName));
    if (!unit) return cb?.({ ok: false, error: "Already chose a mode." });
    cb?.({ ok: true });
    emitState(ctx.game);
  });

  socket.on("player:submitAnswer", (text, cb) => {
    const ctx = playerCtx();
    if (!ctx?.player.unitId) return cb?.({ ok: false });
    const { game, player } = ctx;
    const ok = game.submitAnswer(player.unitId, text);
    cb?.({ ok });
    if (!ok) return;
    if (game.allUnitsSubmitted()) {
      if (game.current.mode === "match") return doCloseMatch(game);
      if (game.current.mode === "vote") return doCloseVoteSubmissions(game);
    }
    emitState(game);
  });

  socket.on("player:buzz", (_, cb) => {
    const ctx = playerCtx();
    if (!ctx?.player.unitId) return cb?.({ ok: false });
    const { game, player } = ctx;
    const ok = game.buzz(player.unitId);
    if (ok) {
      const unitId = player.unitId;
      scheduleTimer(game, BUZZER_ANSWER_TIME * 1000, () => doBuzzerTimeout(game, unitId));
      emitState(game);
    }
    cb?.({ ok });
  });

  socket.on("player:submitBuzzerAnswer", (text, cb) => {
    const ctx = playerCtx();
    if (!ctx?.player.unitId) return cb?.({ ok: false });
    const ok = ctx.game.submitBuzzerAnswer(ctx.player.unitId, text);
    cb?.({ ok });
    if (ok) emitState(ctx.game);
  });

  socket.on("player:vote", (optionId, cb) => {
    const ctx = playerCtx();
    if (!ctx?.player.unitId) return cb?.({ ok: false });
    const { game, player } = ctx;
    const ok = game.vote(player.unitId, optionId);
    cb?.({ ok });
    if (!ok) return;
    if (game.allUnitsVoted()) return doCloseVoting(game);
    emitState(game);
  });

  socket.on("disconnect", () => {
    // Game state lives in memory for the life of the process, so a refreshed
    // page can rejoin with the code (host) or code + playerId (player).
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Jeopardy server running on http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  On your network: http://${ip}:${PORT}`);
});
