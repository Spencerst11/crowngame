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
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

const rankOrder = ['3','4','5','6','7','8','9','10','J','Q','K'];
const suits = ['stars','diamonds','hearts','spades','clubs'];

/* =========================
   Deck + Helpers
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
   Room Broadcast
========================= */

function broadcastRoom(room) {
  const cardsPerPlayer = room.round + 2;
  const wildRank = getWildRank(cardsPerPlayer);

  room.players.forEach(p => {
    const sock = io.sockets.sockets.get(p.id);
    if (!sock) return;

    sock.emit('room-state', {
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
        handCount: x.hand.length,
        score: x.score,
        goneOut: x.goneOut,
        lastTurnComplete: x.lastTurnComplete
      })),
      hand: p.hand
    });
  });
}

/* =========================
   Turn Control (skip goneOut)
========================= */

function advanceTurn(room) {
  if (!room.turnOrder.length) return;

  let safety = 0;
  let idx = room.turnOrder.indexOf(room.currentTurnPlayerId);
  if (idx === -1) idx = 0;

  while (safety < room.turnOrder.length + 2) {
    idx = (idx + 1) % room.turnOrder.length;
    const nextId = room.turnOrder[idx];
    const nextPlayer = room.players.find(p => p.id === nextId);

    // Skip players who already went out (they should not keep taking turns)
    if (nextPlayer && !nextPlayer.goneOut) {
      room.currentTurnPlayerId = nextId;
      return;
    }
    safety++;
  }

  // Fallback if somehow everyone is goneOut (shouldn't happen mid-round)
  room.currentTurnPlayerId = room.turnOrder[0];
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
    p.ready = false; // you re-ready each round (if you ever use lobby again)
  });

  const cards = room.round + 2;
  for (let i = 0; i < cards; i++) {
    room.players.forEach(p => p.hand.push(room.drawPile.pop()));
  }

  room.discardPile.push(room.drawPile.pop());

  room.turnOrder = room.players.map(p => p.id);

  // Start with 2nd seat like your current logic
  room.currentTurnPlayerId = room.turnOrder[1 % room.turnOrder.length];

  broadcastRoom(room);
}

function endRoundAndMaybeStartNext(room) {
  const cardsPerPlayer = room.round + 2;
  const wildRank = getWildRank(cardsPerPlayer);

  // Add scores for players who did NOT go out
  room.players.forEach(p => {
    if (p.goneOut) return; // ✅ went out = 0 points for this round
    const add = p.hand.reduce((sum, card) => sum + cardValue(card, wildRank), 0);
    p.score += add;
  });

  // Clear hands and per-round state
  room.players.forEach(p => {
    p.hand = [];
    p.hasDrawn = false;
    p.goneOut = false;
    p.lastTurnComplete = false;
  });

  room.round++;

  if (room.round > TOTAL_ROUNDS) {
    room.status = 'finished';
    broadcastRoom(room);
    return;
  }

  // ✅ Auto-start next round immediately (what you asked for)
  startRound(room);
}

/* =========================
   Socket Logic
========================= */

io.on('connection', socket => {

  socket.on('create-room', ({ roomCode, name, password }) => {
    if (password !== PASSWORD) return socket.emit('create-error', 'Wrong password');
    if (!roomCode || !name) return socket.emit('create-error', 'Room code and name required');
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
      lastTurnComplete: false
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
    if (room.players.length >= MAX_PLAYERS) return socket.emit('join-error', 'Room full');

    room.players.push({
      id: socket.id,
      name,
      ready: false,
      score: 0,
      hand: [],
      hasDrawn: false,
      goneOut: false,
      lastTurnComplete: false
    });

    socket.join(roomCode);
    socket.emit('join-success', { roomCode });
    broadcastRoom(room);
  });

  socket.on('toggle-ready', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.status !== 'lobby') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.ready = !player.ready;

    const allReady =
      room.players.length >= MIN_PLAYERS &&
      room.players.every(p => p.ready);

    broadcastRoom(room);

    if (allReady) startRound(room);
  });

  socket.on('draw-card', ({ roomCode, source }) => {
    const room = rooms.get(roomCode);
    const player = room?.players.find(p => p.id === socket.id);

    if (!room || room.status !== 'playing') return;
    if (!player) return;
    if (room.currentTurnPlayerId !== player.id) return;
    if (player.goneOut) return;
    if (player.hasDrawn) return;

    const card = source === 'discard'
      ? room.discardPile.pop()
      : room.drawPile.pop();

    if (!card) return;

    player.hand.push(card);
    player.hasDrawn = true;

    broadcastRoom(room);
  });

  socket.on('discard-card', ({ roomCode, cardId }) => {
    const room = rooms.get(roomCode);
    const player = room?.players.find(p => p.id === socket.id);

    if (!room || room.status !== 'playing') return;
    if (!player) return;
    if (room.currentTurnPlayerId !== player.id) return;
    if (player.goneOut) return;
    if (!player.hasDrawn) return;

    const idx = player.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;

    room.discardPile.push(player.hand.splice(idx, 1)[0]);
    player.hasDrawn = false;

    // ✅ If someone already went out, this discard ends THIS player's final turn
    if (room.goOutPlayerId && player.id !== room.goOutPlayerId) {
      player.lastTurnComplete = true;

      // If all non-goOut players have completed their last turn -> end round
      const remaining = room.players.filter(p =>
        p.id !== room.goOutPlayerId && !p.lastTurnComplete
      );

      if (remaining.length === 0) {
        endRoundAndMaybeStartNext(room);
        return;
      }
    }

    // Normal turn advance
    advanceTurn(room);

    // Ensure the next current player starts fresh
    const next = room.players.find(p => p.id === room.currentTurnPlayerId);
    if (next) next.hasDrawn = false;

    broadcastRoom(room);
  });

  socket.on('submit-melds', ({ roomCode, discardCardId, markGoOut }) => {
    const room = rooms.get(roomCode);
    const player = room?.players.find(p => p.id === socket.id);

    if (!room || room.status !== 'playing') return;
    if (!player) return;
    if (room.currentTurnPlayerId !== player.id) return;
    if (!markGoOut) return;

    // Must have drawn first
    if (!player.hasDrawn) return;

    // Discard the last card server-side
    const idx = player.hand.findIndex(c => c.id === discardCardId);
    if (idx === -1) return;

    room.discardPile.push(player.hand.splice(idx, 1)[0]);

    // Mark go-out
    room.goOutPlayerId = player.id;
    player.goneOut = true;
    player.lastTurnComplete = true;
    player.hasDrawn = false;

    // Give everyone else exactly one final turn
    room.players.forEach(p => {
      if (p.id !== player.id) {
        p.lastTurnComplete = false;
        p.hasDrawn = false;
      }
    });

    // Advance immediately to the next player (skip goneOut players)
    advanceTurn(room);

    const next = room.players.find(p => p.id === room.currentTurnPlayerId);
    if (next) next.hasDrawn = false;

    broadcastRoom(room);
  });

  socket.on('reset-round', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.status = 'lobby';
    room.round = 1;
    room.goOutPlayerId = null;
    room.currentTurnPlayerId = null;
    room.drawPile = [];
    room.discardPile = [];
    room.turnOrder = [];

    room.players.forEach(p => {
      p.ready = false;
      p.score = 0;
      p.hand = [];
      p.hasDrawn = false;
      p.goneOut = false;
      p.lastTurnComplete = false;
    });

    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    rooms.forEach((room, code) => {
      room.players = room.players.filter(p => p.id !== socket.id);

      if (!room.players.length) {
        rooms.delete(code);
        return;
      }

      room.turnOrder = room.players.map(p => p.id);

      if (room.currentTurnPlayerId === socket.id) {
        room.currentTurnPlayerId = room.turnOrder[0] || null;
      }

      broadcastRoom(room);
    });
  });
});

server.listen(process.env.PORT || 3000, () =>
  console.log('Crown server running')
);
