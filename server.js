const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PASSWORD = '5Crown';
const MAX_PLAYERS = 7;
const MIN_PLAYERS = 2;
const TOTAL_ROUNDS = 11;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

const rankOrder = ['3','4','5','6','7','8','9','10','J','Q','K'];
const suits = ['stars','diamonds','hearts','spades','clubs'];

/* =========================
   Deck Helpers
========================= */

function createDeck() {
  const deck = [];
  for (let d = 0; d < 2; d++) {
    suits.forEach(s =>
      rankOrder.forEach(r =>
        deck.push({ id: uuidv4(), rank: r, suit: s })
      )
    );
    for (let j = 0; j < 3; j++) {
      deck.push({ id: uuidv4(), rank: 'Joker', suit: 'joker' });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getWildRank(n) {
  if (n <= 10) return String(n);
  if (n === 11) return 'J';
  if (n === 12) return 'Q';
  return 'K';
}

function cardValue(card, wildRank) {
  if (card.rank === 'Joker') return 50;
  if (card.rank === wildRank) return 20;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return Number(card.rank);
}

/* =========================
   Turn Control (FIXED)
========================= */

function advanceTurn(room) {
  const n = room.turnOrder.length;
  let idx = room.turnOrder.indexOf(room.currentTurnPlayerId);
  if (idx === -1) idx = 0;

  for (let i = 0; i < n; i++) {
    idx = (idx + 1) % n;
    const id = room.turnOrder[idx];
    const p = room.players.find(x => x.id === id);
    if (!p) continue;

    if (room.goOutPlayerId && p.goneOut) continue;
    if (room.goOutPlayerId && p.lastTurnComplete) continue;

    room.currentTurnPlayerId = id;
    p.hasDrawn = false;
    return;
  }
}

/* =========================
   Round Control
========================= */

function startRound(room) {
  room.deck = shuffle(createDeck());
  room.drawPile = [...room.deck];
  room.discardPile = [];
  room.status = 'playing';
  room.goOutPlayerId = null;

  room.players.forEach(p => {
    p.hand = [];
    p.hasDrawn = false;
    p.goneOut = false;
    p.lastTurnComplete = false;
    p.laidMelds = [];
    p.laidMeldIds = [];
  });

  const cards = room.round + 2;
  for (let i = 0; i < cards; i++) {
    room.players.forEach(p => p.hand.push(room.drawPile.pop()));
  }

  room.discardPile.push(room.drawPile.pop());
  room.turnOrder = room.players.map(p => p.id);
  room.currentTurnPlayerId = room.turnOrder[0];

  broadcastRoom(room);
}

function endRoundAndStartNext(room) {
  const wildRank = getWildRank(room.round + 2);

  room.players.forEach(p => {
    if (p.goneOut) return;

    const score = p.hand.reduce(
      (sum, c) => sum + cardValue(c, wildRank),
      0
    );
    p.score += score;
  });

  room.round++;
  if (room.round > TOTAL_ROUNDS) {
    room.status = 'finished';
    broadcastRoom(room);
    return;
  }

  room.status = 'lobby';
  room.players.forEach(p => p.ready = false);
  broadcastRoom(room);
}

/* =========================
   Broadcast
========================= */

function broadcastRoom(room) {
  const wildRank = getWildRank(room.round + 2);

  room.players.forEach(p => {
    const s = io.sockets.sockets.get(p.id);
    if (!s) return;

    s.emit('room-state', {
      roomCode: room.code,
      you: p.id,
      round: room.round,
      wildRank,
      drawCount: room.drawPile.length,
      discardTop: room.discardPile.at(-1) || null,
      currentTurnPlayerId: room.currentTurnPlayerId,
      goOutPlayerId: room.goOutPlayerId,
      status: room.status,
      players: room.players.map(x => ({
        id: x.id,
        name: x.name,
        ready: x.ready,
        score: x.score,
        handCount: x.hand.length,
        goneOut: x.goneOut
      })),
      hand: p.hand
    });
  });
}

/* =========================
   Socket Logic
========================= */

io.on('connection', socket => {

  socket.on('create-room', ({ roomCode, name, password }) => {
    if (password !== PASSWORD) return socket.emit('create-error', 'Wrong password');
    if (rooms.has(roomCode)) return socket.emit('create-error', 'Room exists');

    const room = {
      code: roomCode,
      players: [],
      round: 1,
      drawPile: [],
      discardPile: [],
      status: 'lobby',
      currentTurnPlayerId: null,
      goOutPlayerId: null,
      turnOrder: []
    };

    room.players.push({
      id: socket.id,
      name,
      ready: false,
      score: 0,
      hand: [],
      hasDrawn: false,
      goneOut: false,
      lastTurnComplete: false,
      laidMelds: [],
      laidMeldIds: []
    });

    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit('join-success', { roomCode });
    broadcastRoom(room);
  });

  socket.on('join', ({ roomCode, name, password }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('join-error', 'Room not found');
    if (password !== PASSWORD) return socket.emit('join-error', 'Wrong password');

    room.players.push({
      id: socket.id,
      name,
      ready: false,
      score: 0,
      hand: [],
      hasDrawn: false,
      goneOut: false,
      lastTurnComplete: false,
      laidMelds: [],
      laidMeldIds: []
    });

    socket.join(roomCode);
    socket.emit('join-success', { roomCode });
    broadcastRoom(room);
  });

  socket.on('toggle-ready', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const p = room.players.find(x => x.id === socket.id);
    p.ready = !p.ready;

    if (
      room.players.length >= MIN_PLAYERS &&
      room.players.every(x => x.ready)
    ) startRound(room);

    broadcastRoom(room);
  });

  socket.on('draw-card', ({ roomCode, source }) => {
    const room = rooms.get(roomCode);
    const p = room?.players.find(x => x.id === socket.id);
    if (!room || room.status !== 'playing') return;
    if (room.currentTurnPlayerId !== p.id) return;
    if (p.hasDrawn) return;

    const card =
      source === 'discard'
        ? room.discardPile.pop()
        : room.drawPile.pop();

    if (!card) return;

    p.hand.push(card);
    p.hasDrawn = true;
    broadcastRoom(room);
  });

  socket.on('discard-card', ({ roomCode, cardId }) => {
    const room = rooms.get(roomCode);
    const p = room?.players.find(x => x.id === socket.id);
    if (!room || room.status !== 'playing') return;
    if (room.currentTurnPlayerId !== p.id) return;
    if (!p.hasDrawn) return;

    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;

    room.discardPile.push(p.hand.splice(idx, 1)[0]);
    p.hasDrawn = false;

    if (room.goOutPlayerId) {
      p.lastTurnComplete = true;
      if (room.players.every(x => x.goneOut || x.lastTurnComplete)) {
        return endRoundAndStartNext(room);
      }
    }

    advanceTurn(room);
    broadcastRoom(room);
  });

  socket.on('submit-melds', ({ roomCode, discardCardId, markGoOut }) => {
    const room = rooms.get(roomCode);
    const p = room?.players.find(x => x.id === socket.id);
    if (!room || room.status !== 'playing') return;
    if (room.currentTurnPlayerId !== p.id) return;
    if (!markGoOut) return;

    const idx = p.hand.findIndex(c => c.id === discardCardId);
    if (idx === -1) return;

    room.discardPile.push(p.hand.splice(idx, 1)[0]);
    p.goneOut = true;
    p.lastTurnComplete = true;
    p.hasDrawn = false;
    room.goOutPlayerId ??= p.id;

    if (room.players.every(x => x.goneOut || x.lastTurnComplete)) {
      return endRoundAndStartNext(room);
    }

    advanceTurn(room);
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    rooms.forEach((room, code) => {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (!room.players.length) rooms.delete(code);
      else broadcastRoom(room);
    });
  });
});

server.listen(process.env.PORT || 3000, () =>
  console.log('Crown server running')
);
