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
  Hindrer at samme Shopify-ordre legges inn flere ganger
  dersom Shopify Flow prøver HTTP-kallet på nytt.
*/
const receivedOrders = new Set();

function cleanText(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase();
}

function broadcast() {
  io.emit("queue:update", {
    current,
    queue
  });
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

function insertPriorityEntry(entry) {
  /*
    Skip the Line-kunder plasseres foran vanlige kunder,
    men etter andre som allerede har kjøpt Skip the Line.

    Den som åpnes akkurat nå påvirkes ikke.
  */
  const lastPriorityIndex = queue.reduce((lastIndex, item, index) => {
    return item.skipTheLine ? index : lastIndex;
  }, -1);

  queue.splice(lastPriorityIndex + 1, 0, entry);
}

/* Hent hele køen */
app.get("/api/queue", (req, res) => {
  res.json({
    current,
    queue
  });
});

/* Legg til ny ordre */
app.post("/api/queue", (req, res) => {
  const name = cleanText(req.body.name);
  const order = cleanText(req.body.order);
  const items = cleanText(req.body.items);
  const live = cleanText(req.body.live);

  if (!name) {
    return res.status(400).json({
      error: "Navn mangler"
    });
  }

  /*
    Ekstra sikkerhet:
    Sealed-ordrer legges ikke i køen selv om Flow sender dem.
  */
  if (!isLiveOrder(live)) {
    return res.status(200).json({
      ignored: true,
      reason: "Ordren skal sendes sealed"
    });
  }

  /*
    Hindrer duplikater fra Shopify Flow.
    Ordrenummer brukes som unik identifikator.
  */
  if (order && receivedOrders.has(order)) {
    return res.status(200).json({
      ignored: true,
      duplicate: true,
      reason: "Ordren finnes allerede i køsystemet"
    });
  }

  const skipTheLine = containsSkipTheLine(req.body, items);
  const giveaway = containsGiveaway(req.body, order, items);

  const entry = {
    id: nextId++,
    name,
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
    queue.push(entry);
  }

  broadcast();

  /*
    Overlayet du allerede har lagt inn reagerer på denne.
  */
  if (skipTheLine) {
    io.emit("skip:alert", {
      id: entry.id,
      name: entry.name,
      order: entry.order
    });
  } else if (giveaway) {
    /*
      Klargjort for neste overlay-versjon.
      Gir ingen feil selv om overlayet ikke lytter ennå.
    */
    io.emit("giveaway:alert", {
      id: entry.id,
      name: entry.name,
      order: entry.order,
      items: entry.items
    });
  } else {
    /*
      Klargjort for ny ordre-animasjon.
    */
    io.emit("order:alert", {
      id: entry.id,
      name: entry.name,
      order: entry.order,
      items: entry.items
    });
  }

  res.status(201).json(entry);
});

/* Sett første ventende kunde som «Åpnes nå» */
app.post("/api/next", (req, res) => {
  current = queue.shift() || null;
  broadcast();

  res.json({
    current,
    queue
  });
});

/* Marker nåværende kunde som ferdig */
app.post("/api/finish", (req, res) => {
  current = null;
  broadcast();

  res.json({
    current,
    queue
  });
});

/* Fjern én person fra køen */
app.delete("/api/queue/:id", (req, res) => {
  const id = Number(req.params.id);
  const entry = queue.find(item => item.id === id);

  queue = queue.filter(item => item.id !== id);

  /*
    Gjør det mulig å motta ordren på nytt dersom den ble
    fjernet manuelt ved et uhell.
  */
  if (entry?.order) {
    receivedOrders.delete(entry.order);
  }

  broadcast();
  res.status(204).end();
});

/* Flytt én plass opp */
app.post("/api/queue/:id/up", (req, res) => {
  const id = Number(req.params.id);
  const index = queue.findIndex(item => item.id === id);

  if (index > 0) {
    [queue[index - 1], queue[index]] = [
      queue[index],
      queue[index - 1]
    ];
  }

  broadcast();

  res.json({
    current,
    queue
  });
});

/* Flytt én plass ned */
app.post("/api/queue/:id/down", (req, res) => {
  const id = Number(req.params.id);
  const index = queue.findIndex(item => item.id === id);

  if (index >= 0 && index < queue.length - 1) {
    [queue[index], queue[index + 1]] = [
      queue[index + 1],
      queue[index]
    ];
  }

  broadcast();

  res.json({
    current,
    queue
  });
});

/* Flytt en eksisterende kunde til Skip the Line-delen */
app.post("/api/queue/:id/skip", (req, res) => {
  const id = Number(req.params.id);
  const index = queue.findIndex(item => item.id === id);

  if (index === -1) {
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
    order: entry.order
  });

  res.json({
    current,
    queue,
    entry
  });
});

/* Flytt en kunde direkte til første plass i ventekøen */
app.post("/api/queue/:id/top", (req, res) => {
  const id = Number(req.params.id);
  const index = queue.findIndex(item => item.id === id);

  if (index === -1) {
    return res.status(404).json({
      error: "Fant ikke kunden i køen"
    });
  }

  const [entry] = queue.splice(index, 1);
  queue.unshift(entry);

  broadcast();

  res.json({
    current,
    queue,
    entry
  });
});

/* Tøm ventekøen */
app.delete("/api/queue", (req, res) => {
  queue = [];
  receivedOrders.clear();

  broadcast();

  res.json({
    current,
    queue
  });
});

io.on("connection", socket => {
  socket.emit("queue:update", {
    current,
    queue
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Pokebua-kø kjører på port ${PORT}`);
  console.log(`Admin:   /admin.html`);
  console.log(`Overlay: /overlay.html`);
});
