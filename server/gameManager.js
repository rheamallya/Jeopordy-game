const { customAlphabet, nanoid } = require("nanoid");
const { isMatch } = require("./scoring");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const genCode = customAlphabet(CODE_ALPHABET, 5);

const MATCH_DEFAULT_TIME = 20;
const VOTE_SUBMIT_DEFAULT_TIME = 25;
const VOTE_PHASE_DEFAULT_TIME = 15;
const BUZZER_ANSWER_TIME = 12;

class Game {
  constructor(code, board, hostSocketId) {
    this.code = code;
    this.board = board; // { title, categories: [{ id, name, questions: [{id,value,prompt,mode,answer,acceptedAnswers,timeLimit}] }] }
    this.hostSocketId = hostSocketId;
    this.phase = "lobby"; // lobby | board | question | ended
    this.players = new Map(); // playerId -> { id, name, socketId, unitId }
    this.units = new Map(); // unitId -> { id, name, memberIds: Set, score, isTeam }
    this.usedQuestionIds = new Set();
    this.current = null;
    this.createdAt = Date.now();
  }

  // ---------- lobby ----------

  addPlayer(name, socketId) {
    const id = nanoid(10);
    this.players.set(id, { id, name, socketId, unitId: null });
    return id;
  }

  findRejoinablePlayer(name) {
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) return p;
    }
    return null;
  }

  reattachPlayer(playerId, socketId) {
    const p = this.players.get(playerId);
    if (p) p.socketId = socketId;
    return p;
  }

  chooseSolo(playerId) {
    const player = this.players.get(playerId);
    if (!player || player.unitId) return null;
    const unitId = nanoid(8);
    const unit = { id: unitId, name: player.name, memberIds: new Set([playerId]), score: 0, isTeam: false };
    this.units.set(unitId, unit);
    player.unitId = unitId;
    return unit;
  }

  chooseTeam(playerId, teamName) {
    const player = this.players.get(playerId);
    if (!player || player.unitId) return null;
    const cleanName = teamName.trim().slice(0, 24) || "Team";
    let unit = [...this.units.values()].find(
      (u) => u.isTeam && u.name.toLowerCase() === cleanName.toLowerCase() && u.memberIds.size < 2
    );
    if (!unit) {
      const unitId = nanoid(8);
      unit = { id: unitId, name: cleanName, memberIds: new Set(), score: 0, isTeam: true };
      this.units.set(unitId, unit);
    }
    unit.memberIds.add(playerId);
    player.unitId = unit.id;
    return unit;
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (player.unitId) {
      const unit = this.units.get(player.unitId);
      if (unit) {
        unit.memberIds.delete(playerId);
        if (unit.memberIds.size === 0) this.units.delete(unit.id);
      }
    }
    this.players.delete(playerId);
  }

  startGame() {
    this.phase = "board";
  }

  // ---------- board / scoreboard view ----------

  getScoreboard() {
    return [...this.units.values()]
      .map((u) => ({
        id: u.id,
        name: u.name,
        isTeam: u.isTeam,
        score: u.score,
        members: [...u.memberIds].map((pid) => this.players.get(pid)?.name).filter(Boolean),
      }))
      .sort((a, b) => b.score - a.score);
  }

  getLobbyState() {
    return {
      code: this.code,
      players: [...this.players.values()].map((p) => ({ name: p.name, unitId: p.unitId })),
      units: [...this.units.values()].map((u) => ({
        id: u.id,
        name: u.name,
        isTeam: u.isTeam,
        size: u.memberIds.size,
        members: [...u.memberIds].map((pid) => this.players.get(pid)?.name).filter(Boolean),
      })),
    };
  }

  getBoardView() {
    return {
      title: this.board.title,
      categories: this.board.categories.map((c) => ({
        id: c.id,
        name: c.name,
        questions: c.questions.map((q) => ({
          id: q.id,
          value: q.value,
          used: this.usedQuestionIds.has(q.id),
        })),
      })),
      scoreboard: this.getScoreboard(),
    };
  }

  findQuestion(questionId) {
    for (const cat of this.board.categories) {
      const q = cat.questions.find((q) => q.id === questionId);
      if (q) return { question: q, category: cat };
    }
    return null;
  }

  isBoardComplete() {
    const total = this.board.categories.reduce((n, c) => n + c.questions.length, 0);
    return this.usedQuestionIds.size >= total;
  }

  // ---------- question lifecycle ----------

  clearTimer() {
    if (this.current?.timer) {
      clearTimeout(this.current.timer);
      this.current.timer = null;
    }
  }

  revealQuestion(questionId) {
    if (this.usedQuestionIds.has(questionId)) return null;
    const found = this.findQuestion(questionId);
    if (!found) return null;
    const { question, category } = found;
    this.phase = "question";
    this.current = {
      questionId: question.id,
      categoryName: category.name,
      value: question.value,
      prompt: question.prompt,
      mode: question.mode,
      answer: question.answer || "",
      acceptedAnswers: question.acceptedAnswers || [],
      timeLimit: question.timeLimit,
      stage: question.mode === "buzzer" ? "open" : "collecting",
      submissions: new Map(), // unitId -> { text, submittedAt }
      triedUnitIds: new Set(),
      lockedUnitId: null,
      votes: new Map(), // unitId -> optionId
      voteOptions: null,
      timer: null,
    };
    if (question.mode === "match" || question.mode === "vote") {
      const seconds = question.timeLimit || (question.mode === "match" ? MATCH_DEFAULT_TIME : VOTE_SUBMIT_DEFAULT_TIME);
      this.current.deadline = Date.now() + seconds * 1000;
    }
    return this.current;
  }

  clientQuestionView() {
    if (!this.current) return null;
    const c = this.current;
    return {
      questionId: c.questionId,
      categoryName: c.categoryName,
      value: c.value,
      prompt: c.prompt,
      mode: c.mode,
      stage: c.stage,
      deadline: c.deadline || null,
      lockedUnitId: c.lockedUnitId,
      triedUnitIds: [...c.triedUnitIds],
    };
  }

  submitAnswer(unitId, text) {
    const c = this.current;
    if (!c || c.stage !== "collecting") return false;
    if (!["match", "vote"].includes(c.mode)) return false;
    c.submissions.set(unitId, { text: String(text).slice(0, 200), submittedAt: Date.now() });
    return true;
  }

  allUnitsSubmitted() {
    const c = this.current;
    if (!c) return false;
    const unitIds = [...this.units.keys()];
    return unitIds.length > 0 && unitIds.every((id) => c.submissions.has(id));
  }

  // MATCH mode: close submissions -> auto-grade -> host review list
  closeMatchSubmissions() {
    const c = this.current;
    if (!c || c.mode !== "match") return null;
    this.clearTimer();
    c.stage = "review";
    const results = [...c.submissions.entries()].map(([unitId, sub]) => ({
      unitId,
      unitName: this.units.get(unitId)?.name || "Unknown",
      text: sub.text,
      autoCorrect: isMatch(sub.text, [c.answer, ...c.acceptedAnswers]),
    }));
    c.reviewResults = results;
    return results;
  }

  finalizeMatch(overrides) {
    const c = this.current;
    if (!c || c.mode !== "match") return null;
    const results = c.reviewResults.map((r) => {
      const correct = overrides && Object.prototype.hasOwnProperty.call(overrides, r.unitId) ? !!overrides[r.unitId] : r.autoCorrect;
      if (correct) {
        const unit = this.units.get(r.unitId);
        if (unit) unit.score += c.value;
      }
      return { ...r, correct };
    });
    c.stage = "results";
    c.finalResults = results;
    return results;
  }

  // VOTE mode: close submissions -> build anonymized options -> voting stage
  closeVoteSubmissions() {
    const c = this.current;
    if (!c || c.mode !== "vote") return null;
    this.clearTimer();
    const entries = [...c.submissions.entries()];
    const shuffled = entries.sort(() => Math.random() - 0.5);
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    c.voteOptions = shuffled.map(([unitId, sub], idx) => ({
      id: nanoid(6),
      label: letters[idx] || `#${idx + 1}`,
      unitId,
      text: sub.text,
    }));
    c.stage = "voting";
    const seconds = VOTE_PHASE_DEFAULT_TIME;
    c.deadline = Date.now() + seconds * 1000;
    return c.voteOptions;
  }

  vote(unitId, optionId) {
    const c = this.current;
    if (!c || c.stage !== "voting") return false;
    const option = c.voteOptions.find((o) => o.id === optionId);
    if (!option) return false;
    if (option.unitId === unitId) return false; // can't vote for own submission
    c.votes.set(unitId, optionId);
    return true;
  }

  allUnitsVoted() {
    const c = this.current;
    if (!c) return false;
    // units with no submission can still vote; units that submitted have nothing to vote for only if they're the sole submitter
    const eligible = [...this.units.keys()].filter((id) => c.voteOptions.some((o) => o.unitId !== id));
    return eligible.length > 0 && eligible.every((id) => c.votes.has(id));
  }

  closeVoting() {
    const c = this.current;
    if (!c || c.mode !== "vote") return null;
    this.clearTimer();
    const tally = new Map();
    for (const optionId of c.votes.values()) tally.set(optionId, (tally.get(optionId) || 0) + 1);
    let maxVotes = 0;
    for (const v of tally.values()) maxVotes = Math.max(maxVotes, v);
    const winningOptions = c.voteOptions.filter((o) => (tally.get(o.id) || 0) === maxVotes && maxVotes > 0);
    for (const opt of winningOptions) {
      const unit = this.units.get(opt.unitId);
      if (unit) unit.score += c.value;
    }
    c.stage = "results";
    c.finalResults = c.voteOptions.map((o) => ({
      optionId: o.id,
      label: o.label,
      text: o.text,
      unitId: o.unitId,
      unitName: this.units.get(o.unitId)?.name || "Unknown",
      votes: tally.get(o.id) || 0,
      won: winningOptions.includes(o),
    }));
    return c.finalResults;
  }

  // BUZZER mode
  buzz(unitId) {
    const c = this.current;
    if (!c || c.mode !== "buzzer" || c.stage !== "open") return false;
    if (c.triedUnitIds.has(unitId)) return false;
    c.lockedUnitId = unitId;
    c.stage = "answering";
    c.buzzedAt = Date.now();
    c.deadline = Date.now() + BUZZER_ANSWER_TIME * 1000;
    return true;
  }

  submitBuzzerAnswer(unitId, text) {
    const c = this.current;
    if (!c || c.mode !== "buzzer" || c.stage !== "answering" || c.lockedUnitId !== unitId) return false;
    c.buzzerAnswer = { unitId, text: String(text).slice(0, 200) };
    this.clearTimer(); // answer is in; wait for the host to judge
    c.deadline = null;
    return true;
  }

  judgeBuzzer(correct) {
    const c = this.current;
    if (!c || c.mode !== "buzzer" || c.stage !== "answering") return null;
    const unitId = c.lockedUnitId;
    if (correct) {
      const unit = this.units.get(unitId);
      if (unit) unit.score += c.value;
      c.stage = "results";
      c.finalResults = { winnerUnitId: unitId, winnerName: unit?.name || "", answer: c.buzzerAnswer?.text || "" };
      return c.finalResults;
    }
    c.triedUnitIds.add(unitId);
    c.lockedUnitId = null;
    c.buzzerAnswer = null;
    c.deadline = null;
    this.clearTimer();
    const allTried = [...this.units.keys()].every((id) => c.triedUnitIds.has(id));
    if (allTried) {
      c.stage = "results";
      c.finalResults = { winnerUnitId: null, answer: null };
      return c.finalResults;
    }
    c.stage = "open";
    return { reopened: true };
  }

  adjustScore(unitId, delta) {
    const unit = this.units.get(unitId);
    if (!unit) return false;
    unit.score += Number(delta) || 0;
    return true;
  }

  endGame() {
    if (this.current) this.usedQuestionIds.add(this.current.questionId);
    this.clearTimer();
    this.current = null;
    this.phase = "ended";
  }

  backToBoard() {
    if (this.current) this.usedQuestionIds.add(this.current.questionId);
    this.clearTimer();
    this.current = null;
    this.phase = this.isBoardComplete() ? "ended" : "board";
    return this.phase;
  }
}

const MODES = new Set(["match", "buzzer", "vote"]);

// Sanitize a board coming from the client: guarantee ids, numeric values and
// a valid answer mode; drop questions without a prompt.
function normalizeBoard(raw) {
  if (!raw || !Array.isArray(raw.categories)) return null;
  const categories = raw.categories
    .map((c) => ({
      id: String(c.id || nanoid(8)),
      name: String(c.name || "Category").slice(0, 40),
      questions: (Array.isArray(c.questions) ? c.questions : [])
        .filter((q) => q && String(q.prompt || "").trim())
        .map((q) => ({
          id: String(q.id || nanoid(8)),
          value: Math.max(0, Math.round(Number(q.value) || 0)),
          prompt: String(q.prompt).slice(0, 500),
          mode: MODES.has(q.mode) ? q.mode : "match",
          answer: String(q.answer || "").slice(0, 200),
          acceptedAnswers: (Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers : [])
            .map((a) => String(a).trim())
            .filter(Boolean),
          timeLimit: Math.min(300, Math.max(5, Number(q.timeLimit) || 20)),
        })),
    }))
    .filter((c) => c.questions.length > 0);
  if (categories.length === 0) return null;
  return { title: String(raw.title || "Jeopardy").slice(0, 60), categories };
}

class GameManager {
  constructor() {
    this.games = new Map();
  }

  createGame(rawBoard, hostSocketId) {
    const board = normalizeBoard(rawBoard);
    if (!board) throw new Error("Invalid board");
    let code;
    do {
      code = genCode();
    } while (this.games.has(code));
    const game = new Game(code, board, hostSocketId);
    this.games.set(code, game);
    return game;
  }

  get(code) {
    return this.games.get(String(code || "").toUpperCase());
  }

  remove(code) {
    this.games.delete(code);
  }
}

module.exports = { GameManager, normalizeBoard, MATCH_DEFAULT_TIME, VOTE_SUBMIT_DEFAULT_TIME, VOTE_PHASE_DEFAULT_TIME, BUZZER_ANSWER_TIME };
