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

/*
  Start nedtelling.

  Body:
  {
    "minutes": 30
  }
*/
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

/*
  Avbryt nedtelling eller åpne køen igjen.
*/
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

  /*
    Sealed-ordrer legges ikke i livekøen.
  */
  if (!isLiveOrder(live)) {
    return res.status(200).json({
      ignored: true,
      reason: "Ordren skal sendes sealed"
    });
  }

  /*
    Hindrer duplikater fra Shopify Flow.
  */
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
  /*
    KØ STENGT-kortet skal aldri bli aktiv ordre.
  */
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

  /*
    Beholder eventuelle elementer som manglet i forespørselen.
  */
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
   SOCKET.IO
========================================================= */

io.on("connection", socket => {
  socket.emit(
    "queue:update",
    getPublicState()
  );
});

/* =========================================================
   START SERVER
========================================================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    `Pokebua-kø kjører på port ${PORT}`
  );

  console.log(
    "Admin:   /admin.html"
  );

  console.log(
    "Overlay: /overlay.html"
  );
});
