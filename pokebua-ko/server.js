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

function broadcast() {
  io.emit("queue:update", { current, queue });
}

app.get("/api/queue", (req, res) => {
  res.json({ current, queue });
});

app.post("/api/queue", (req, res) => {
  const name = String(req.body.name || "").trim();
  const order = String(req.body.order || "").trim();
  const items = String(req.body.items || "").trim();

  if (!name) {
    return res.status(400).json({ error: "Navn mangler" });
  }

  const entry = { id: nextId++, name, order, items };
  queue.push(entry);
  broadcast();
  res.status(201).json(entry);
});

app.post("/api/next", (req, res) => {
  current = queue.shift() || null;
  broadcast();
  res.json({ current, queue });
});

app.post("/api/finish", (req, res) => {
  current = null;
  broadcast();
  res.json({ current, queue });
});

app.delete("/api/queue/:id", (req, res) => {
  const id = Number(req.params.id);
  queue = queue.filter(item => item.id !== id);
  broadcast();
  res.status(204).end();
});

app.post("/api/queue/:id/up", (req, res) => {
  const id = Number(req.params.id);
  const index = queue.findIndex(item => item.id === id);
  if (index > 0) {
    [queue[index - 1], queue[index]] = [queue[index], queue[index - 1]];
  }
  broadcast();
  res.json({ current, queue });
});

app.post("/api/queue/:id/down", (req, res) => {
  const id = Number(req.params.id);
  const index = queue.findIndex(item => item.id === id);
  if (index >= 0 && index < queue.length - 1) {
    [queue[index + 1], queue[index]] = [queue[index], queue[index + 1]];
  }
  broadcast();
  res.json({ current, queue });
});

io.on("connection", socket => {
  socket.emit("queue:update", { current, queue });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Pokebua-kø kjører på http://localhost:${PORT}`);
  console.log(`Admin:   http://localhost:${PORT}/admin.html`);
  console.log(`Overlay: http://localhost:${PORT}/overlay.html`);
});
