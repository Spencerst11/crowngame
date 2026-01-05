const socket = io({
  transports: ["websocket"],
});
socket.on("connect", () => {
  console.log("✅ Socket connected:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("❌ Socket connection error:", err.message);
});
const entryScreen = document.getElementById('entry-screen');
const gameScreen = document.getElementById('game');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const readyBtn = document.getElementById('ready-btn');
const scoreBtn = document.getElementById('score-btn');
const scoreTab = document.getElementById('score-tab');
const scoreToggle = document.getElementById('score-toggle');
const resetBtn = document.getElementById('reset-btn');
const handEl = document.getElementById('hand');

const meldError = document.getElementById('meld-error');
const drawBtn = document.getElementById('draw-card');
const discardBtn = document.getElementById('pickup-discard');
const discardSelectedBtn = document.getElementById('discard-selected');
const goOutBtn = document.getElementById('go-out');


const drawPile = document.getElementById('draw-pile');
const discardPile = document.getElementById('discard-pile');
const discardCard = document.getElementById('discard-card');

const roundLabel = document.getElementById('round-label');
const wildLabel = document.getElementById('wild-label');
const roomLabel = document.getElementById('room-label');
const drawCount = document.getElementById('draw-count');
const scoreBody = document.getElementById('score-body');
const playersEl = document.getElementById('players');
const entryError = document.getElementById('entry-error');
const startGroupBtn = document.getElementById('start-group');
const ungroupSelectedBtn = document.getElementById('ungroup-selected');
const groupsEl = document.getElementById('groups');
const state = {
  roomCode: null,
  you: null,
  hand: [],
  
  selected: new Set(),
 
  wildRank: null,
  players: [],
  discardTop: null,
  drawCount: 0,
  round: 1,
  currentTurn: null,
  goOutPlayerId: null,
  status: 'lobby'
};
let bannerTimeout = null;

function showBanner(message) {
  const banner = document.getElementById("game-banner");
  if (!banner) return;

  banner.textContent = message;
  banner.classList.remove("hidden");

  if (bannerTimeout) clearTimeout(bannerTimeout);

  bannerTimeout = setTimeout(() => {
    banner.classList.add("hidden");
  }, 6000);
}
function getInputs() {
  return {
    room: document.getElementById('room').value.trim(),
    name: document.getElementById('name').value.trim(),
    password: document.getElementById('password').value.trim()
  };
}

createBtn.addEventListener('click', () => handleEntry('create'));
joinBtn.addEventListener('click', () => handleEntry('join'));

function handleEntry(mode) {
  const { room, name, password } = getInputs();
  if (!room || !name || !password) {
    entryError.textContent = 'Enter the password, room code, and your name.';
    return;
  }
  entryError.textContent = '';
  if (mode === 'create') {
    socket.emit('create-room', { roomCode: room, name, password });
  } else {
    socket.emit('join', { roomCode: room, name, password });
  }
}

readyBtn.addEventListener('click', () => {
  if (!state.roomCode) return;
  socket.emit('toggle-ready', { roomCode: state.roomCode });
});

resetBtn.addEventListener('click', () => {
  if (!state.roomCode) return;
  socket.emit('reset-round', { roomCode: state.roomCode });
});

drawBtn.addEventListener('click', () => {
  if (!state.roomCode) return;
  socket.emit('draw-card', { roomCode: state.roomCode, source: 'draw' });
});

discardBtn.addEventListener('click', () => {
  if (!state.roomCode) return;
  socket.emit('draw-card', { roomCode: state.roomCode, source: 'discard' });
});

discardSelectedBtn.addEventListener('click', () => {
  if (!state.roomCode) return;
  const selected = Array.from(state.selected);
  if (selected.length !== 1) {
    meldError.textContent = 'Select a single card in your hand to discard.';
    return;
  }
  socket.emit('discard-card', { roomCode: state.roomCode, cardId: selected[0] });
  state.selected.clear();
});

handEl.addEventListener('click', (e) => {
  const cardEl = e.target.closest('.card');
  if (!cardEl || !cardEl.dataset.id) return;
  toggleSelect(cardEl.dataset.id);
});





goOutBtn.addEventListener('click', () => {
  meldError.textContent = '';
  if (!state.roomCode) return;
  socket.emit('submit-melds', { roomCode: state.roomCode, melds: state.melds, markGoOut: true });
});

scoreBtn.addEventListener('click', toggleScoreboard);
scoreToggle.addEventListener('click', toggleScoreboard);

function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  renderHand();
}

socket.on('join-error', (msg) => {
  entryError.textContent = msg;
});

socket.on('join-success', ({ roomCode }) => {
  state.roomCode = roomCode;
  entryError.textContent = '';
  socket.emit('request-state', { roomCode });
});

socket.on('create-error', (msg) => {
  entryError.textContent = msg;
});

socket.on('meld-error', (msg) => {
  meldError.textContent = msg;
});

socket.on('room-state', (data) => {
  const previousRound = state.round;
  state.roomCode = data.roomCode || state.roomCode;
  state.you = data.you;
  state.hand = data.hand || [];
  state.confirmedMelds = data.laidMelds || [];
  if (state.confirmedMelds.length) {
    state.melds = [];
    state.selected.clear();
  }
  state.players = data.players || [];
  state.discardTop = data.discardTop;
  state.drawCount = data.drawCount || 0;
  state.round = data.round;
  state.currentTurn = data.currentTurnPlayerId;
  state.goOutPlayerId = data.goOutPlayerId;
  state.status = data.status;
  state.wildRank = data.wildRank;
  if (state.round !== previousRound) {
    state.melds = [];
    state.selected.clear();
  }
  renderGame();
});

function renderGame() {
  entryScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  roomLabel.textContent = state.roomCode;
  roundLabel.textContent = state.round;
  wildLabel.textContent = state.wildRank;
  drawCount.textContent = state.drawCount;
  const me = state.players.find((p) => p.id === state.you);
  if (me) readyBtn.textContent = me.ready ? 'Unready' : 'Ready up';
  renderHand();
  renderDiscard();
  renderPlayers();
}

function renderDiscard() {
  if (state.discardTop) {
    renderCard(discardCard, state.discardTop);
  } else {
    discardCard.textContent = '--';
    discardCard.className = 'card';
  }
}

function renderPlayers() {
  playersEl.innerHTML = '';
  const count = state.players.length;
  const radiusX = 45;
  const radiusY = 45;
  state.players.forEach((p, idx) => {
    const angle = (idx / count) * 2 * Math.PI;
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.style.left = `${50 + radiusX * Math.cos(angle)}%`;
    seat.style.top = `${50 + radiusY * Math.sin(angle)}%`;

    const badge = document.createElement('div');
    badge.className = 'badge';

    const ready = document.createElement('span');
    ready.className = 'ready-dot' + (p.ready ? ' active' : '');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;

    const countSpan = document.createElement('span');
    countSpan.className = 'count';
    countSpan.textContent = `${p.handCount} cards`;

    badge.appendChild(ready);
    badge.appendChild(name);
    badge.appendChild(countSpan);

    seat.appendChild(badge);

    if (state.currentTurn === p.id) {
      const turnTag = document.createElement('div');
      turnTag.className = 'tag';
      turnTag.textContent = 'Turn';
      seat.appendChild(turnTag);
    }

    if (p.goneOut) {
      const bubbleWrap = document.createElement('div');
      bubbleWrap.className = 'gone-out';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = '!';
      bubbleWrap.appendChild(bubble);
      const label = document.createElement('span');
      label.textContent = 'Going out';
      bubbleWrap.appendChild(label);
      seat.appendChild(bubbleWrap);
    }

    if (p.laidMelds && p.laidMelds.length) {
      const laid = document.createElement('div');
      laid.className = 'meld-group';
      laid.style.display = 'inline-flex';
      laid.style.flexWrap = 'wrap';
      laid.style.gap = '4px';
      p.laidMelds.forEach((card) => {
        laid.appendChild(createCard(card));
      });
      seat.appendChild(laid);
    }

    playersEl.appendChild(seat);
  });const msg = buildStatus();
if (msg) showBanner(msg);
  renderScores();
}

function buildStatus() {
  if (state.status === 'lobby') {
    return 'Waiting for everyone to ready (2–7 players).';
  }

  if (state.status === 'finished') {
    return 'Game finished!';
  }

  if (state.goOutPlayerId) {
    return 'Someone has gone out! One last turn!';
  }

  if (state.currentTurn === state.you) {
    return 'Your turn!';
  }

  return null;
}
function renderHand() {
  handEl.innerHTML = '';
  state.hand.forEach((card) => {
    const cardEl = createCard(card);
    if (state.selected.has(card.id)) cardEl.classList.add('selected');
    cardEl.dataset.id = card.id;
    handEl.appendChild(cardEl);
  });
}



function renderCard(target, card) {
  target.className = 'card';
  target.dataset.suit = card.suit;
  target.innerHTML = `
    <div class="rank top-left">${card.rank}</div>
    <div class="center-suit">${suitSymbol(card.suit)}</div>
    <div class="rank bottom-right">${card.rank}</div>
  `;
}

function createCard(card) {
  const div = document.createElement('div');
  div.className = 'card';
  div.dataset.suit = card.suit;
  div.innerHTML = `
    <div class="rank top-left">${card.rank}</div>
    <div class="center-suit">${suitSymbol(card.suit)}</div>
    <div class="rank bottom-right">${card.rank}</div>
  `;
  return div;
}

function suitSymbol(suit) {
  switch (suit) {
    case 'stars': return '★';
    case 'diamonds': return '◆';
    case 'hearts': return '♥';
    case 'spades': return '♠';
    case 'clubs': return '♣';
    default: return '☆';
  }
}

function renderScores() {
  scoreBody.innerHTML = '';
  state.players
    .slice()
    .sort((a, b) => a.score - b.score)
    .forEach((p) => {
      const row = document.createElement('div');
      row.className = 'score-row';
      const name = document.createElement('span');
      name.textContent = p.name;
      const score = document.createElement('span');
      score.textContent = p.score;
      row.appendChild(name);
      row.appendChild(score);
      scoreBody.appendChild(row);
    });
}

function toggleScoreboard() {
  if (!scoreTab) return;
  scoreTab.classList.toggle('collapsed');
  const open = !scoreTab.classList.contains('collapsed');
  scoreToggle.textContent = open ? 'Scores ▾' : 'Scores ▸';
}

socket.on('connect', () => {
  if (state.roomCode) {
    socket.emit('request-state', { roomCode: state.roomCode });
  }
});

// Double click discard pile to take top
discardPile.addEventListener('dblclick', () => {
  if (!state.roomCode) return;
  socket.emit('draw-card', { roomCode: state.roomCode, source: 'discard' });
});

// Draw pile click draws
 drawPile.addEventListener('click', () => {
  if (!state.roomCode) return;
  socket.emit('draw-card', { roomCode: state.roomCode, source: 'draw' });
});

// Discard selected card with keyboard D
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'd' && state.roomCode) {
    const selected = Array.from(state.selected);
    if (selected.length === 1) {
      socket.emit('discard-card', { roomCode: state.roomCode, cardId: selected[0] });
      state.selected.clear();
    }
  }
});

