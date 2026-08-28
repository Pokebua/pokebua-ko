const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let queue = [];
let current = null;
let nextId = 1;

/*
  Status for automatisk køstenging.
*/
let queueClosingAt = null;
let queueClosed = false;
let queueClosingTimer = null;

/*
  Hindrer at samme Shopify-ordre legges inn flere ganger
  dersom Shopify Flow prøver HTTP-kallet på nytt.
*/
const receivedOrders = new Set();

/* =========================================================
   HJELPEFUNKSJONER
========================================================= */

function cleanText(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase();
}

function isQueueClosedEntry(entry = {}) {
  return (
    entry.system === true &&
    entry.type === "queue-closed"
  );
}

function getQueueClosedEntry() {
  return queue.find(isQueueClosedEntry) || null;
}

function removeQueueClosedEntry() {
  queue = queue.filter(
    entry => !isQueueClosedEntry(entry)
  );
}

function getPublicState() {
  return {
    current,
    queue,
    queueClosingAt,
    queueClosed
  };
}

function broadcast() {
  io.emit("queue:update", getPublicState());
}

function isLiveOrder(liveValue) {
  const value = normalize(liveValue);

  /*
    Dersom Flow ikke sender live-feltet, tillates ordren
    for å bevare kompatibilitet med eksisterende oppsett.
  */
  if (!value) {
    return true;
  }

  return ![
    "nei",
    "no",
    "false",
    "sealed",
    "sendes sealed",
    "sendes uåpnet",
    "uåpnet"
  ].includes(value);
}

function containsSkipTheLine(body, items) {
  if (
    body.skip === true ||
    body.skipTheLine === true ||
    body.priority === true
  ) {
    return true;
  }

  const text = normalize(items);

  return (
    text.includes("skip the line") ||
    text.includes("skip-the-line") ||
    text.includes("skip køen") ||
    text.includes("hopp foran i køen")
  );
}

function containsGiveaway(body, order, items) {
  if (body.giveaway === true) {
    return true;
  }

  const text = normalize(`${order} ${items}`);

  return (
    text.includes("giveaway") ||
    text.includes("give away") ||
    text.includes("følger giveaway")
  );
}

/*
  Vanlige ordre legges foran KØ STENGT-kortet.
  Systemkortet blir derfor alltid liggende nederst.
*/
function insertBeforeClosedCard(entry) {
  const closedIndex = queue.findIndex(
    isQueueClosedEntry
  );

  if (closedIndex === -1) {
    queue.push(entry);
    return;
  }

  queue.splice(closedIndex, 0, entry);
}

/*
  Skip the Line plasseres etter eksisterende
  Skip the Line-kunder, men foran vanlige kunder.
*/
function insertPriorityEntry(entry) {
  const lastPriorityIndex = queue.reduce(
    (lastIndex, item, index) => {
      if (isQueueClosedEntry(item)) {
        return lastIndex;
      }

      return item.skipTheLine || item.priority
        ? index
        : lastIndex;
    },
    -1
  );

  queue.splice(lastPriorityIndex + 1, 0, entry);
}

/* =========================================================
   KØSTENGING
========================================================= */

function closeQueue() {
  if (queueClosingTimer) {
    clearTimeout(queueClosingTimer);
    queueClosingTimer = null;
  }

  queueClosingAt = null;
  queueClosed = true;

  /*
    Hindrer at flere KØ STENGT-kort opprettes.
  */
  if (!getQueueClosedEntry()) {
    queue.push({
      id: nextId++,
      system: true,
      type: "queue-closed",
      name: "KØ STENGT",
      order: "",
      items: "Ingen flere bestillinger i kveld",
      skipTheLine: false,
      priority: false,
      giveaway: false,
      createdAt: new Date().toISOString()
    });
  }

  broadcast();

  io.emit("queue:closed", {
    queueClosed: true
  });
}

function startQueueClosingTimer(minutes) {
  if (queueClosingTimer) {
    clearTimeout(queueClosingTimer);
    queueClosingTimer = null;
  }

  /*
    En ny nedtelling åpner køen igjen og fjerner
    et gammelt KØ STENGT-kort.
  */
  removeQueueClosedEntry();

  queueClosed = false;

  const closingTime =
    Date.now() + minutes * 60 * 1000;

  queueClosingAt =
    new Date(closingTime).toISOString();

  queueClosingTimer = setTimeout(() => {
    closeQueue();
  }, minutes * 60 * 1000);

  broadcast();
}

function openQueueAgain() {
  if (queueClosingTimer) {
    clearTimeout(queueClosingTimer);
    queueClosingTimer = null;
  }

  queueClosingAt = null;
  queueClosed = false;

  removeQueueClosedEntry();
  broadcast();
}

/* =========================================================
   API – HENT KØ
========================================================= */

app.get("/api/queue", (req, res) => {
  res.json(getPublicState());
});

/* =========================================================
   API – KØSTENGING
========================================================= */

app.post("/api/queue/closing", (req, res) => {
  const minutes = Number(req.body.minutes);

  if (
    !Number.isFinite(minutes) ||
    minutes <= 0
  ) {
    return res.status(400).json({
      error: "Antall minutter må være større enn 0"
    });
  }

  if (minutes > 1440) {
    return res.status(400).json({
      error: "Maksimal nedtelling er 1440 minutter"
    });
  }

  startQueueClosingTimer(minutes);

  res.json({
    success: true,
    ...getPublicState()
  });
});

app.delete("/api/queue/closing", (req, res) => {
  openQueueAgain();

  res.json({
    success: true,
    ...getPublicState()
  });
});

/* =========================================================
   API – LEGG TIL ORDRE
========================================================= */

app.post("/api/queue", (req, res) => {
  const name = cleanText(req.body.name);
  const twitchName = cleanText(req.body.twitchName);
  const order = cleanText(req.body.order);
  const items = cleanText(req.body.items);
  const live = cleanText(req.body.live);

  if (!name && !twitchName) {
    return res.status(400).json({
      error: "Navn mangler"
    });
  }

  if (!isLiveOrder(live)) {
    return res.status(200).json({
      ignored: true,
      reason: "Ordren skal sendes sealed"
    });
  }

  if (
    order &&
    receivedOrders.has(order)
  ) {
    return res.status(200).json({
      ignored: true,
      duplicate: true,
      reason: "Ordren finnes allerede i køsystemet"
    });
  }

  const skipTheLine =
    containsSkipTheLine(req.body, items);

  const giveaway =
    containsGiveaway(req.body, order, items);

  const entry = {
    id: nextId++,
    name: name || twitchName,
    twitchName,
    order,
    items,
    skipTheLine,
    priority: skipTheLine,
    giveaway,
    createdAt: new Date().toISOString()
  };

  if (order) {
    receivedOrders.add(order);
  }

  if (skipTheLine) {
    insertPriorityEntry(entry);
  } else {
    insertBeforeClosedCard(entry);
  }

  broadcast();

  if (skipTheLine) {
    io.emit("skip:alert", {
      id: entry.id,
      name: entry.name,
      twitchName: entry.twitchName,
      order: entry.order
    });
  } else if (giveaway) {
    io.emit("giveaway:alert", {
      id: entry.id,
      name: entry.name,
      twitchName: entry.twitchName,
      order: entry.order,
      items: entry.items
    });
  } else {
    io.emit("order:alert", {
      id: entry.id,
      name: entry.name,
      twitchName: entry.twitchName,
      order: entry.order,
      items: entry.items
    });
  }

  res.status(201).json(entry);
});

/* =========================================================
   API – NESTE OG FERDIG
========================================================= */

app.post("/api/next", (req, res) => {
  const firstCustomerIndex = queue.findIndex(
    entry => !isQueueClosedEntry(entry)
  );

  if (firstCustomerIndex === -1) {
    current = null;
  } else {
    const [nextCustomer] = queue.splice(
      firstCustomerIndex,
      1
    );

    current = nextCustomer;
  }

  broadcast();
  res.json(getPublicState());
});

app.post("/api/finish", (req, res) => {
  current = null;

  broadcast();
  res.json(getPublicState());
});

/* =========================================================
   API – FJERN KØELEMENT
========================================================= */

app.delete("/api/queue/:id", (req, res) => {
  const id = Number(req.params.id);

  const entry = queue.find(
    item => item.id === id
  );

  if (!entry) {
    return res.status(404).json({
      error: "Fant ikke elementet i køen"
    });
  }

  queue = queue.filter(
    item => item.id !== id
  );

  if (entry.order) {
    receivedOrders.delete(entry.order);
  }

  if (isQueueClosedEntry(entry)) {
    queueClosed = false;
    queueClosingAt = null;
  }

  broadcast();
  res.status(204).end();
});

/* =========================================================
   API – FLYTT OPP OG NED
========================================================= */

app.post("/api/queue/:id/up", (req, res) => {
  const id = Number(req.params.id);

  const index = queue.findIndex(
    item => item.id === id
  );

  if (
    index > 0 &&
    !isQueueClosedEntry(queue[index]) &&
    !isQueueClosedEntry(queue[index - 1])
  ) {
    [
      queue[index - 1],
      queue[index]
    ] = [
      queue[index],
      queue[index - 1]
    ];
  }

  broadcast();
  res.json(getPublicState());
});

app.post("/api/queue/:id/down", (req, res) => {
  const id = Number(req.params.id);

  const index = queue.findIndex(
    item => item.id === id
  );

  if (
    index >= 0 &&
    index < queue.length - 1 &&
    !isQueueClosedEntry(queue[index]) &&
    !isQueueClosedEntry(queue[index + 1])
  ) {
    [
      queue[index],
      queue[index + 1]
    ] = [
      queue[index + 1],
      queue[index]
    ];
  }

  broadcast();
  res.json(getPublicState());
});

/* =========================================================
   API – DRA OG SLIPP / NY REKKEFØLGE
========================================================= */

app.post("/api/queue/reorder", (req, res) => {
  const ids = Array.isArray(req.body.ids)
    ? req.body.ids.map(Number)
    : [];

  if (!ids.length) {
    return res.status(400).json({
      error: "Ingen kø-ID-er ble sendt"
    });
  }

  const existingById = new Map(
    queue.map(entry => [
      Number(entry.id),
      entry
    ])
  );

  const reordered = [];

  ids.forEach(id => {
    const entry = existingById.get(id);

    if (!entry) {
      return;
    }

    reordered.push(entry);
    existingById.delete(id);
  });

  existingById.forEach(entry => {
    reordered.push(entry);
  });

  const closedEntry =
    reordered.find(isQueueClosedEntry);

  queue = reordered.filter(
    entry => !isQueueClosedEntry(entry)
  );

  if (closedEntry) {
    queue.push(closedEntry);
  }

  broadcast();
  res.json(getPublicState());
});

/* =========================================================
   API – SKIP THE LINE
========================================================= */

app.post("/api/queue/:id/skip", (req, res) => {
  const id = Number(req.params.id);

  const index = queue.findIndex(
    item => item.id === id
  );

  if (
    index === -1 ||
    isQueueClosedEntry(queue[index])
  ) {
    return res.status(404).json({
      error: "Fant ikke kunden i køen"
    });
  }

  const [entry] = queue.splice(index, 1);

  entry.skipTheLine = true;
  entry.priority = true;

  insertPriorityEntry(entry);
  broadcast();

  io.emit("skip:alert", {
    id: entry.id,
    name: entry.name,
    twitchName: entry.twitchName,
    order: entry.order
  });

  res.json({
    ...getPublicState(),
    entry
  });
});

/* =========================================================
   API – FLYTT TIL TOPP
========================================================= */

app.post("/api/queue/:id/top", (req, res) => {
  const id = Number(req.params.id);

  const index = queue.findIndex(
    item => item.id === id
  );

  if (
    index === -1 ||
    isQueueClosedEntry(queue[index])
  ) {
    return res.status(404).json({
      error: "Fant ikke kunden i køen"
    });
  }

  const [entry] = queue.splice(index, 1);
  queue.unshift(entry);

  broadcast();

  res.json({
    ...getPublicState(),
    entry
  });
});

/* =========================================================
   API – TØM KØ
========================================================= */

app.delete("/api/queue", (req, res) => {
  queue = [];
  receivedOrders.clear();

  if (queueClosingTimer) {
    clearTimeout(queueClosingTimer);
    queueClosingTimer = null;
  }

  queueClosingAt = null;
  queueClosed = false;

  broadcast();
  res.json(getPublicState());
});

/* =========================================================
   POKEBUA GAME – LAST TRAINER STANDING
========================================================= */

const GAME_MAX_PLAYERS = 100;

const gameQuestions = [
  {
    question: "Hvilken type er Pikachu?",
    answers: {
      A: "Fire",
      B: "Water",
      C: "Electric",
      D: "Grass"
    },
    correct: "C"
  },
  {
    question: "Hvilken Pokémon er nummer #001?",
    answers: {
      A: "Bulbasaur",
      B: "Charmander",
      C: "Squirtle",
      D: "Pikachu"
    },
    correct: "A"
  },
  {
    question: "Hvilken type er super effective mot Fire?",
    answers: {
      A: "Grass",
      B: "Water",
      C: "Bug",
      D: "Steel"
    },
    correct: "B"
  },
  {
    question: "Hva utvikler Eevee seg til med en Thunder Stone?",
    answers: {
      A: "Flareon",
      B: "Vaporeon",
      C: "Espeon",
      D: "Jolteon"
    },
    correct: "D"
  },
  {
    question: "Hvilken Pokémon er kjent som Mewtwos genetiske opphav?",
    answers: {
      A: "Mew",
      B: "Ditto",
      C: "Arceus",
      D: "Celebi"
    },
    correct: "A"
  },
  {
    question: "Hvilken type er Charizard?",
    answers: {
      A: "Fire / Flying",
      B: "Fire / Dragon",
      C: "Dragon",
      D: "Fire"
    },
    correct: "A"
  },
  {
    question: "Hvilken Pokémon utvikler seg til Raichu?",
    answers: {
      A: "Pichu",
      B: "Pikachu",
      C: "Plusle",
      D: "Pachirisu"
    },
    correct: "B"
  },
  {
    question: "Hvem er en Water-type starter?",
    answers: {
      A: "Torchic",
      B: "Treecko",
      C: "Mudkip",
      D: "Chikorita"
    },
    correct: "C"
  }
];

let gameNextPlayerId = 1;
let gameQuestionIndex = 0;
let gameTimer = null;

let gameState = {
  lobbyOpen: false,
  maxPlayers: GAME_MAX_PLAYERS,
  phase: "waiting",
  round: 0,
  players: [],
  currentQuestion: null,
  answersLocked: false,
  revealCorrectAnswer: false,
  winner: null,
  questionEndsAt: null
};

function cleanGameName(value) {
  return String(value || "")
    .replace(/^@/, "")
    .trim()
    .slice(0, 30);
}

function gameAlivePlayers() {
  return gameState.players.filter(
    player => player.alive
  );
}

function getGamePublicState() {
  let question = null;

  if (gameState.currentQuestion) {
    question = {
      question:
        gameState.currentQuestion.question,

      answers:
        gameState.currentQuestion.answers,

      correct:
        gameState.revealCorrectAnswer
          ? gameState.currentQuestion.correct
          : null
    };
  }

  return {
    lobbyOpen: gameState.lobbyOpen,
    maxPlayers: gameState.maxPlayers,
    phase: gameState.phase,
    round: gameState.round,
    players: gameState.players,
    currentQuestion: question,
    answersLocked: gameState.answersLocked,
    revealCorrectAnswer:
      gameState.revealCorrectAnswer,
    winner: gameState.winner,
    questionEndsAt: gameState.questionEndsAt,
    aliveCount: gameAlivePlayers().length,
    playerCount: gameState.players.length
  };
}

function broadcastGame() {
  io.emit(
    "game:update",
    getGamePublicState()
  );
}

function clearGameTimer() {
  if (gameTimer) {
    clearTimeout(gameTimer);
    gameTimer = null;
  }
}

function resetGameState() {
  clearGameTimer();

  gameState = {
    lobbyOpen: false,
    maxPlayers: GAME_MAX_PLAYERS,
    phase: "waiting",
    round: 0,
    players: [],
    currentQuestion: null,
    answersLocked: false,
    revealCorrectAnswer: false,
    winner: null,
    questionEndsAt: null
  };

  gameNextPlayerId = 1;
  gameQuestionIndex = 0;

  broadcastGame();
}

function addGamePlayer(rawName) {
  const name =
    cleanGameName(rawName);

  if (!name) {
    return {
      error: "Navn mangler"
    };
  }

  if (!gameState.lobbyOpen) {
    return {
      error: "Lobbyen er stengt"
    };
  }

  if (
    gameState.players.length >=
    gameState.maxPlayers
  ) {
    return {
      error: "Lobbyen er full"
    };
  }

  const duplicate =
    gameState.players.find(
      player =>
        normalize(player.name) ===
        normalize(name)
    );

  if (duplicate) {
    return {
      player: duplicate,
      duplicate: true
    };
  }

  const player = {
    id: gameNextPlayerId++,
    name,
    alive: true,
    answer: null,
    joinedAt:
      new Date().toISOString()
  };

  gameState.players.push(player);

  io.emit(
    "game:player-joined",
    player
  );

  broadcastGame();

  return {
    player
  };
}

function submitGameAnswer(
  rawName,
  rawAnswer
) {
  const name =
    cleanGameName(rawName);

  const answer =
    String(rawAnswer || "")
      .trim()
      .toUpperCase();

  if (
    gameState.phase !== "question" ||
    gameState.answersLocked
  ) {
    return {
      error:
        "Det tas ikke imot svar akkurat nå"
    };
  }

  if (
    !["A", "B", "C", "D"]
      .includes(answer)
  ) {
    return {
      error:
        "Svar må være A, B, C eller D"
    };
  }

  const player =
    gameState.players.find(
      entry =>
        normalize(entry.name) ===
        normalize(name)
    );

  if (!player) {
    return {
      error:
        "Spilleren er ikke med i spillet"
    };
  }

  if (!player.alive) {
    return {
      error:
        "Spilleren er eliminert"
    };
  }

  player.answer = answer;

  io.emit(
    "game:answer-received",
    {
      id: player.id,
      name: player.name,
      answer
    }
  );

  broadcastGame();

  return {
    player
  };
}

function startGameQuestion(
  question,
  durationSeconds = 12
) {
  clearGameTimer();

  gameState.round += 1;
  gameState.currentQuestion =
    question;

  gameState.phase =
    "question";

  gameState.answersLocked =
    false;

  gameState.revealCorrectAnswer =
    false;

  gameState.winner =
    null;

  gameAlivePlayers()
    .forEach(player => {
      player.answer = null;
    });

  const seconds =
    Math.max(
      3,
      Math.min(
        Number(durationSeconds) || 12,
        120
      )
    );

  gameState.questionEndsAt =
    new Date(
      Date.now() +
      seconds * 1000
    ).toISOString();

  io.emit(
    "game:question",
    {
      round:
        gameState.round,

      question:
        question.question,

      answers:
        question.answers,

      durationSeconds:
        seconds,

      questionEndsAt:
        gameState.questionEndsAt
    }
  );

  broadcastGame();

  gameTimer =
    setTimeout(() => {

      if (
        gameState.phase ===
          "question" &&
        !gameState.answersLocked
      ) {
        gameState.answersLocked =
          true;

        gameState.phase =
          "locked";

        gameState.questionEndsAt =
          null;

        io.emit(
          "game:locked"
        );

        broadcastGame();
      }

    }, seconds * 1000);
}

function eliminateWrongGamePlayers() {
  if (
    !gameState.currentQuestion
  ) {
    return {
      error:
        "Ingen aktivt spørsmål"
    };
  }

  const correct =
    gameState.currentQuestion.correct;

  const eliminated = [];

  gameAlivePlayers()
    .forEach(player => {

      if (
        player.answer !==
        correct
      ) {
        player.alive =
          false;

        eliminated.push({
          id: player.id,
          name: player.name
        });
      }

    });

  const alive =
    gameAlivePlayers();

  gameState.phase =
    "results";

  if (alive.length === 1) {
    gameState.phase =
      "winner";

    gameState.winner = {
      id: alive[0].id,
      name: alive[0].name
    };

    gameState.lobbyOpen =
      false;

  } else if (
    alive.length === 0
  ) {
    gameState.phase =
      "finished";

    gameState.winner =
      null;

    gameState.lobbyOpen =
      false;
  }

  io.emit(
    "game:elimination",
    {
      eliminated,
      aliveCount:
        alive.length,
      winner:
        gameState.winner
    }
  );

  if (
    gameState.winner
  ) {
    io.emit(
      "game:winner",
      gameState.winner
    );
  }

  broadcastGame();

  return {
    eliminated,
    aliveCount:
      alive.length
  };
}

/* =========================================================
   GAME API
========================================================= */

app.get(
  "/api/game",
  (req, res) => {

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/lobby/open",
  (req, res) => {

    const requestedMax =
      Number(
        req.body.maxPlayers
      );

    if (
      Number.isFinite(
        requestedMax
      )
    ) {
      gameState.maxPlayers =
        Math.max(
          1,
          Math.min(
            GAME_MAX_PLAYERS,
            Math.floor(
              requestedMax
            )
          )
        );
    }

    gameState.lobbyOpen =
      true;

    gameState.phase =
      "lobby";

    gameState.winner =
      null;

    broadcastGame();

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/lobby/close",
  (req, res) => {

    gameState.lobbyOpen =
      false;

    if (
      gameState.phase ===
      "lobby"
    ) {
      gameState.phase =
        "ready";
    }

    broadcastGame();

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/join",
  (req, res) => {

    const result =
      addGamePlayer(
        req.body.name
      );

    if (
      result.error
    ) {
      return res
        .status(400)
        .json(result);
    }

    res
      .status(
        result.duplicate
          ? 200
          : 201
      )
      .json(result);

  }
);

app.post(
  "/api/game/answer",
  (req, res) => {

    const result =
      submitGameAnswer(
        req.body.name,
        req.body.answer
      );

    if (
      result.error
    ) {
      return res
        .status(400)
        .json(result);
    }

    res.json(result);

  }
);

app.post(
  "/api/game/start",
  (req, res) => {

    if (
      gameState.players.length <
      2
    ) {
      return res
        .status(400)
        .json({
          error:
            "Du trenger minst 2 spillere for å starte"
        });
    }

    clearGameTimer();

    gameState.lobbyOpen =
      false;

    gameState.phase =
      "ready";

    gameState.round =
      0;

    gameState.currentQuestion =
      null;

    gameState.answersLocked =
      false;

    gameState.revealCorrectAnswer =
      false;

    gameState.winner =
      null;

    gameState.questionEndsAt =
      null;

    gameQuestionIndex =
      0;

    gameState.players
      .forEach(player => {
        player.alive =
          true;

        player.answer =
          null;
      });

    io.emit(
      "game:started",
      {
        playerCount:
          gameState.players.length
      }
    );

    broadcastGame();

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/question/next",
  (req, res) => {

    if (
      gameAlivePlayers()
        .length <= 1
    ) {
      return res
        .status(400)
        .json({
          error:
            "Det er ikke nok spillere igjen"
        });
    }

    const question =
      gameQuestions[
        gameQuestionIndex %
        gameQuestions.length
      ];

    gameQuestionIndex += 1;

    startGameQuestion(
      question,
      req.body.durationSeconds
    );

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/question",
  (req, res) => {

    const question =
      cleanText(
        req.body.question
      );

    const answers =
      req.body.answers || {};

    const correct =
      String(
        req.body.correct || ""
      )
        .trim()
        .toUpperCase();

    if (
      !question ||
      !cleanText(
        answers.A
      ) ||
      !cleanText(
        answers.B
      ) ||
      !cleanText(
        answers.C
      ) ||
      !cleanText(
        answers.D
      ) ||
      ![
        "A",
        "B",
        "C",
        "D"
      ].includes(correct)
    ) {
      return res
        .status(400)
        .json({
          error:
            "Spørsmål, fire svaralternativer og riktig svar må fylles ut"
        });
    }

    startGameQuestion(
      {
        question,

        answers: {
          A:
            cleanText(
              answers.A
            ),

          B:
            cleanText(
              answers.B
            ),

          C:
            cleanText(
              answers.C
            ),

          D:
            cleanText(
              answers.D
            )
        },

        correct
      },

      req.body.durationSeconds
    );

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/lock",
  (req, res) => {

    if (
      !gameState.currentQuestion
    ) {
      return res
        .status(400)
        .json({
          error:
            "Ingen aktivt spørsmål"
        });
    }

    clearGameTimer();

    gameState.answersLocked =
      true;

    gameState.phase =
      "locked";

    gameState.questionEndsAt =
      null;

    io.emit(
      "game:locked"
    );

    broadcastGame();

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/reveal",
  (req, res) => {

    if (
      !gameState.currentQuestion
    ) {
      return res
        .status(400)
        .json({
          error:
            "Ingen aktivt spørsmål"
        });
    }

    clearGameTimer();

    gameState.answersLocked =
      true;

    gameState.revealCorrectAnswer =
      true;

    gameState.phase =
      "reveal";

    gameState.questionEndsAt =
      null;

    io.emit(
      "game:reveal",
      {
        correct:
          gameState
            .currentQuestion
            .correct
      }
    );

    broadcastGame();

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/eliminate",
  (req, res) => {

    const result =
      eliminateWrongGamePlayers();

    if (
      result.error
    ) {
      return res
        .status(400)
        .json(result);
    }

    res.json({
      ...getGamePublicState(),
      eliminated:
        result.eliminated
    });

  }
);

app.post(
  "/api/game/test-players",
  (req, res) => {

    const requested =
      Number(
        req.body.count
      );

    const count =
      Math.max(
        1,
        Math.min(
          gameState.maxPlayers,

          Number.isFinite(
            requested
          )
            ? Math.floor(
                requested
              )
            : gameState
                .maxPlayers
        )
      );

    clearGameTimer();

    gameState.players =
      [];

    gameNextPlayerId =
      1;

    gameQuestionIndex =
      0;

    gameState.round =
      0;

    gameState.currentQuestion =
      null;

    gameState.answersLocked =
      false;

    gameState.revealCorrectAnswer =
      false;

    gameState.winner =
      null;

    gameState.questionEndsAt =
      null;

    for (
      let i = 1;
      i <= count;
      i++
    ) {
      gameState.players.push({
        id:
          gameNextPlayerId++,

        name:
          `Trainer${i}`,

        alive:
          true,

        answer:
          null,

        joinedAt:
          new Date()
            .toISOString()
      });
    }

    gameState.phase =
      "lobby";

    gameState.lobbyOpen =
      true;

    broadcastGame();

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/player/:id/revive",
  (req, res) => {

    const id =
      Number(
        req.params.id
      );

    const player =
      gameState.players.find(
        entry =>
          entry.id === id
      );

    if (!player) {
      return res
        .status(404)
        .json({
          error:
            "Fant ikke spilleren"
        });
    }

    player.alive =
      true;

    player.answer =
      null;

    gameState.winner =
      null;

    broadcastGame();

    res.json(
      getGamePublicState()
    );

  }
);

app.delete(
  "/api/game/player/:id",
  (req, res) => {

    const id =
      Number(
        req.params.id
      );

    const before =
      gameState.players.length;

    gameState.players =
      gameState.players.filter(
        player =>
          player.id !== id
      );

    if (
      gameState.players.length ===
      before
    ) {
      return res
        .status(404)
        .json({
          error:
            "Fant ikke spilleren"
        });
    }

    broadcastGame();

    res.json(
      getGamePublicState()
    );

  }
);

app.post(
  "/api/game/reset",
  (req, res) => {

    resetGameState();

    res.json(
      getGamePublicState()
    );

  }
);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", socket => {

  /*
    Eksisterende Pokebua-kø
  */
  socket.emit(
    "queue:update",
    getPublicState()
  );

  /*
    Pokebua Game
  */
  socket.emit(
    "game:update",
    getGamePublicState()
  );

  /*
    Senere bruker vi dette til
    Twitch !join.
  */
  socket.on(
    "game:join",
    payload => {

      addGamePlayer(
        payload &&
        payload.name
      );

    }
  );

  /*
    Senere bruker vi dette til
    Twitch A / B / C / D.
  */
  socket.on(
    "game:answer",
    payload => {

      if (!payload) {
        return;
      }

      submitGameAnswer(
        payload.name,
        payload.answer
      );

    }
  );

});

/* =========================================================
   START SERVER
========================================================= */

const PORT =
  process.env.PORT ||
  3000;

server.listen(
  PORT,
  () => {

    console.log(
      `Pokebua-kø kjører på port ${PORT}`
    );

    console.log(
      "Admin:   /admin.html"
    );

    console.log(
      "Overlay: /overlay.html"
    );

    console.log(
      "Game:    /game/game.html"
    );

    console.log(
      "Game API: /api/game"
    );

  }
);
