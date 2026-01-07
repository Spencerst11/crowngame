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
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

const rankOrder = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const suits = [
  { key: 'stars', color: 'yellow', symbol: '★' },
  { key: 'diamonds', color: 'blue', symbol: '◆' },
  { key: 'hearts', color: 'red', symbol: '♥' },
  { key: 'spades', color: 'black', symbol: '♠' },
  { key: 'clubs', color: 'green', symbol: '♣' }
];

function createDeck() {
  const deck = [];
  for (let deckIndex = 0; deckIndex < 2; deckIndex += 1) {
    suits.forEach((suit) => {
      rankOrder.forEach((rank) => {
        deck.push(createCard(rank, suit.key));
      });
    });
    for (let j = 0; j < 3; j += 1) {
      deck.push(createCard('Joker', 'joker'));
    }
  }
  return deck;
}

function createCard(rank, suit) {
  return {
    id: uuidv4(),
    rank,
    suit
  };
}

function shuffle(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getWildRank(cardsPerPlayer) {
  if (cardsPerPlayer <= 10) {
    return String(cardsPerPlayer);
  }
  if (cardsPerPlayer === 11) return 'J';
  if (cardsPerPlayer === 12) return 'Q';
  return 'K';
}

function isWild(card, wildRank) {
  return card.rank === 'Joker' || card.rank === wildRank;
}

function cardValue(card, wildRank) {
  if (card.rank === 'Joker') return 50;
  if (card.rank === wildRank) return 20;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return Number(card.rank);
}

function rankToIndex(rank) {
  return rankOrder.indexOf(rank);
}

function reshuffleIfNeeded(room) {
  if (room.drawPile.length === 0 && room.discardPile.length > 1) {
    const topCard = room.discardPile.pop();
    room.drawPile = shuffle(room.discardPile);
    room.discardPile = [topCard];
  }
}

function getRoomStateForBroadcast(room) {
  const cardsPerPlayer = room.round + 2;
  const wildRank = getWildRank(cardsPerPlayer);
  return {
    round: room.round,
    cardsPerPlayer,
    wildRank,
    discardTop: room.discardPile[room.discardPile.length - 1] || null,
    drawCount: room.drawPile.length,
    currentTurnPlayerId: room.currentTurnPlayerId,
    goOutPlayerId: room.goOutPlayerId,
    status: room.status,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      handCount: p.hand.length,
      score: p.score,
      goneOut: p.goneOut,
      laidMelds: p.laidMelds,
      lastTurnComplete: p.lastTurnComplete
    }))
  };
}

function broadcastRoom(room) {
  const baseState = getRoomStateForBroadcast(room);
  room.players.forEach((player) => {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      socket.emit('room-state', {
        roomCode: room.code,
        ...baseState,
        you: player.id,
        hand: player.hand,
        laidMelds: player.laidMelds
      });
    }
  });
}

function startRound(room) {
  room.deck = shuffle(createDeck());
  room.drawPile = [...room.deck];
  room.discardPile = [];
  room.status = 'playing';
  room.goOutPlayerId = null;
  room.currentTurnPlayerId = null;
  room.players.forEach((p) => {
    p.hand = [];
    p.ready = false;
    p.hasDrawn = false;
    p.goneOut = false;
    p.laidMelds = [];
    p.laidMeldIds = [];
    p.lastTurnComplete = false;
  });

  const cardsPerPlayer = room.round + 2;
  for (let i = 0; i < cardsPerPlayer; i += 1) {
    room.players.forEach((player) => {
      const card = room.drawPile.pop();
      player.hand.push(card);
    });
  }

  const starter = room.drawPile.pop();
  room.discardPile.push(starter);

  const dealer = room.dealerIndex % room.players.length;
  const nextIndex = (dealer + 1) % room.players.length;
  room.currentTurnPlayerId = room.players[nextIndex].id;
  room.turnOrder = room.players.map((p) => p.id);

  broadcastRoom(room);
}

function endRound(room) {
  const cardsPerPlayer = room.round + 2;
  const wildRank = getWildRank(cardsPerPlayer);
  room.players.forEach((player) => {
    const leftover = player.hand.filter(
      (c) => !player.laidMeldIds.includes(c.id)
    );
    const scoreAdd = leftover.reduce((sum, card) => sum + cardValue(card, wildRank), 0);
    player.score += scoreAdd;
    player.hand = [];
    player.hasDrawn = false;
  });
  room.round += 1;
  room.status = room.round > TOTAL_ROUNDS ? 'finished' : 'lobby';
  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
  broadcastRoom(room);
}

function moveTurn(room) {
  const idx = room.turnOrder.indexOf(room.currentTurnPlayerId);
  const nextIdx = (idx + 1) % room.turnOrder.length;
  room.currentTurnPlayerId = room.turnOrder[nextIdx];
}

function validateMelds(hand, melds, wildRank) {
  if (!Array.isArray(melds)) return { ok: false, message: 'Meld data missing' };
  const handMap = new Map(hand.map((card) => [card.id, card]));
  const used = new Set();
  const usedCards = [];

  for (const meld of melds) {
    if (!Array.isArray(meld) || meld.length < 3) {
      return { ok: false, message: 'Each meld must have at least 3 cards' };
    }
    const cards = [];
    for (const id of meld) {
      if (used.has(id)) {
        return { ok: false, message: 'Card used twice in melds' };
      }
      const card = handMap.get(id);
      if (!card) {
        return { ok: false, message: 'Card not in hand' };
      }
      used.add(id);
      cards.push(card);
      usedCards.push(card);
    }
    if (!isValidBook(cards, wildRank) && !isValidRun(cards, wildRank)) {
      return { ok: false, message: 'Invalid book or run' };
    }
  }
  return { ok: true, usedIds: Array.from(used), usedCards };
}

function isValidBook(cards, wildRank) {
  const nonWild = cards.filter((c) => !isWild(c, wildRank));
  if (nonWild.length === 0) return true;
  const rank = nonWild[0].rank;
  return nonWild.every((c) => c.rank === rank);
}

function isValidRun(cards, wildRank) {
  const nonWild = cards.filter((c) => !isWild(c, wildRank));
  if (nonWild.length === 0) return true;
  const suit = nonWild[0].suit;
  if (!nonWild.every((c) => c.suit === suit)) return false;
  const sorted = nonWild.sort((a, b) => rankToIndex(a.rank) - rankToIndex(b.rank));
  let neededGaps = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const prevIndex = rankToIndex(sorted[i - 1].rank);
    const currentIndex = rankToIndex(sorted[i].rank);
    const gap = currentIndex - prevIndex - 1;
    if (gap < 0) return false;
    neededGaps += gap;
  }
  const wildCount = cards.filter((c) => isWild(c, wildRank)).length;
  return neededGaps <= wildCount;
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ roomCode, name, password }) => {
    if (password !== PASSWORD) {
      socket.emit('create-error', 'Incorrect password.');
      return;
    }
    if (!roomCode || !name) {
      socket.emit('create-error', 'Room code and name are required.');
      return;
    }
    if (rooms.has(roomCode)) {
      socket.emit('create-error', 'That room code is already in use. Try another.');
      return;
    }
    const room = {
      code: roomCode,
      players: [],
      deck: [],
      drawPile: [],
      discardPile: [],
      status: 'lobby',
      round: 1,
      dealerIndex: 0,
      currentTurnPlayerId: null,
      goOutPlayerId: null,
      turnOrder: []
    };
    const player = {
      id: socket.id,
      name,
      ready: false,
      score: 0,
      hand: [],
      hasDrawn: false,
      goneOut: false,
      laidMelds: [],
      laidMeldIds: [],
      lastTurnComplete: false
    };
    room.players.push(player);
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit('join-success', { roomCode });
    broadcastRoom(room);
  });

  socket.on('join', ({ roomCode, name, password }) => {
    if (password !== PASSWORD) {
      socket.emit('join-error', 'Incorrect password.');
      return;
    }
    if (!roomCode || !name) {
      socket.emit('join-error', 'Room code and name are required.');
      return;
    }
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('join-error', 'Room not found. Ask the host to create it first.');
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      socket.emit('join-error', 'Room is full (7 players max).');
      return;
    }
    const player = {
      id: socket.id,
      name,
      ready: false,
      score: 0,
      hand: [],
      hasDrawn: false,
      goneOut: false,
      laidMelds: [],
      laidMeldIds: [],
      lastTurnComplete: false
    };
    room.players.push(player);
    socket.join(roomCode);
    socket.emit('join-success', { roomCode });
    broadcastRoom(room);
  });

  socket.on('toggle-ready', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    if (room.status !== 'lobby') return;
    player.ready = !player.ready;
    const allReady = room.players.length >= MIN_PLAYERS && room.players.every((p) => p.ready);
    broadcastRoom(room);
    if (allReady) {
      startRound(room);
    }
  });

  socket.on('draw-card', ({ roomCode, source }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || room.currentTurnPlayerId !== player.id) return;
    if (player.hasDrawn) return;
    reshuffleIfNeeded(room);
    if (source === 'discard') {
      const top = room.discardPile.pop();
      if (!top) return;
      player.hand.push(top);
    } else {
      const card = room.drawPile.pop();
      if (!card) return;
      player.hand.push(card);
    }
    player.hasDrawn = true;
    broadcastRoom(room);
  });

  socket.on('discard-card', ({ roomCode, cardId }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || room.currentTurnPlayerId !== player.id) return;
    if (!player.hasDrawn) return;
    const index = player.hand.findIndex((c) => c.id === cardId);
    if (index === -1) return;
    const [card] = player.hand.splice(index, 1);
    room.discardPile.push(card);
    player.hasDrawn = false;
    


  if (room.goOutPlayerId && player.id !== room.goOutPlayerId) {
  player.lastTurnComplete = true;
}

// ALWAYS advance turn after a discard
// Advance to next player's turn
moveTurn(room);

// 🔑 RESET hasDrawn FOR THE NEW TURN PLAYER
const nextPlayer = room.players.find(
  p => p.id === room.currentTurnPlayerId
);
if (nextPlayer) {
  nextPlayer.hasDrawn = false;
}

// After advancing turn, check if round should end
if (room.goOutPlayerId) {
  const remaining = room.players.filter(
    p => p.id !== room.goOutPlayerId && !p.lastTurnComplete
  );

  if (remaining.length === 0) {
    endRound(room);
    return;
  }
}

broadcastRoom(room);

  });

  socket.on('submit-melds', ({ roomCode, melds, markGoOut }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    if (room.status !== 'playing') return;
    if (markGoOut && room.currentTurnPlayerId !== player.id) {
      socket.emit('meld-error', 'You can only go out on your turn.');
      return;
    }
    if (markGoOut && !player.hasDrawn) {
      socket.emit('meld-error', 'Draw first, then go out with one card left to discard.');
      return;
    }
    const cardsPerPlayer = room.round + 2;
    const wildRank = getWildRank(cardsPerPlayer);
    const validation = validateMelds(player.hand, melds, wildRank);
    if (!validation.ok) {
      socket.emit('meld-error', validation.message);
      return;
    }
    player.laidMelds = validation.usedCards;
    player.laidMeldIds = validation.usedIds;
   if (markGoOut) {
  // Identify remaining card (exactly one)
  const remainingCard = player.hand.find(
    c => !player.laidMeldIds.includes(c.id)
  );

  if (!remainingCard) {
    socket.emit('meld-error', 'No card to discard.');
    return;
  }

  // 🔥 SERVER-AUTHORITATIVE DISCARD
  player.hand = player.hand.filter(c => c.id !== remainingCard.id);
  room.discardPile.push(remainingCard);

  // Mark go-out state
  room.goOutPlayerId = player.id;
  player.goneOut = true;
  player.hasDrawn = false;
  player.lastTurnComplete = true;

  // Prepare remaining players for final turns
  room.players.forEach(p => {
    if (p.id !== player.id) {
      p.lastTurnComplete = false;
    }
  });

  // Advance turn immediately
  moveTurn(room);

  // Reset draw state for next player
  const nextPlayer = room.players.find(
    p => p.id === room.currentTurnPlayerId
  );
  if (nextPlayer) {
    nextPlayer.hasDrawn = false;
  }

  broadcastRoom(room);
  return;
}
      room.goOutPlayerId = player.id;
      player.goneOut = true;
      room.players.forEach((p) => {
        if (p.id !== player.id) {
          p.lastTurnComplete = false;
        }
      });
    }
    broadcastRoom(room);
  });

  socket.on('request-state', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    broadcastRoom(room);
  });

  socket.on('reset-round', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.status === 'finished') return;
    room.status = 'lobby';
    room.players.forEach((p) => {
      p.ready = false;
      p.hand = [];
      p.hasDrawn = false;
      p.laidMelds = [];
      p.goneOut = false;
      p.lastTurnComplete = false;
    });
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    rooms.forEach((room, code) => {
      const idx = room.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(code);
        } else {
          room.turnOrder = room.turnOrder.filter((id) => id !== socket.id);
          if (room.turnOrder.length && room.currentTurnPlayerId === socket.id) {
            moveTurn(room);
          }
          broadcastRoom(room);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Crown game server running on port ${PORT}`);
});
