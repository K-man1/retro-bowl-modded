"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const protocol = require("./multiplayer-protocol");

const root = __dirname;
const teamRows = fs.readFileSync(path.join(root, "html5game/Teams.txt"), "utf8").trim().split(/\r?\n/).map(line => line.split("\t"));
const teamColumns = teamRows.shift();
const catalog = teamRows.map(columns => Object.fromEntries(teamColumns.map((name, index) => [name, /^-?\d+$/.test(columns[index]) ? Number(columns[index]) : columns[index]])));
const staticFiles = new Set(["index.html", "mod-menu.js", "multiplayer.js", "multiplayer.css", "multiplayer-frame.html", "multiplayer-engine.js", "multiplayer-protocol.js"]);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".ogg": "audio/ogg" };

function createServer({ reconnectMs = 30000, lobbyMs = 30 * 60 * 1000, maxRooms = 100, allowTests = false } = {}) {
  const rooms = new Map();
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1) || "index.html"; }
    catch { response.writeHead(400).end(); return; }
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
    if (pathname === "health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ status: "ok" }));
      return;
    }
    if ((!staticFiles.has(pathname) && !/^(html5game|img)\/[\w.-]+$/.test(pathname) && pathname !== "saves/starter.json" && !(allowTests && /^tests\/[\w.-]+$/.test(pathname))) || pathname.includes("..")) {
      response.writeHead(404).end(); return;
    }
    const filename = path.join(root, pathname);
    fs.stat(filename, (error, stat) => {
      if (error || !stat.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Content-Length": stat.size, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
      if (request.method === "HEAD") response.end();
      else {
        const stream = fs.createReadStream(filename);
        stream.on("error", () => response.destroy());
        stream.pipe(response);
      }
    });
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 4, zlibDeflateOptions: { level: 3 } } });
  server.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    let validOrigin = !origin;
    if (origin) {
      try { validOrigin = new URL(origin).host === request.headers.host; } catch { validOrigin = false; }
    }
    if (request.url !== "/multiplayer" || !validOrigin) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, connection => sockets.emit("connection", connection));
  });

  function send(socket, message, volatile = false) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    if (volatile && socket.bufferedAmount > 64 * 1024) return false;
    if (socket.bufferedAmount > 2 * 1024 * 1024) { socket.close(1013, "Connection too slow"); return false; }
    socket.send(JSON.stringify({ v: protocol.version, ...message }));
    return true;
  }
  function state(room) {
    return { type: "room", code: room.code, phase: room.phase, matchId: room.matchId, settings: room.settings, paused: room.players.some(player => !player?.socket), players: room.players.map(player => player ? { ready: player.ready, connected: Boolean(player.socket), selection: player.selection } : null) };
  }
  function broadcast(room, message, volatile) { room.players.forEach(player => send(player?.socket, message, volatile)); }
  function publish(room) { broadcast(room, state(room)); }
  function destroyRoom(room, reason) {
    broadcast(room, { type: "ended", reason });
    room.players.forEach(player => {
      if (!player) return;
      clearTimeout(player.expiry);
      if (player.socket) { player.socket.seat = null; player.socket.room = null; }
    });
    rooms.delete(room.code);
  }
  function joinSeat(room, seat, socket) {
    const player = { token: crypto.randomBytes(24).toString("hex"), socket, ready: false, selection: null, expiry: null, seq: -1, action: -1 };
    room.players[seat] = player;
    socket.room = room;
    socket.seat = seat;
    send(socket, { type: "joined", code: room.code, player: seat, token: player.token });
    publish(room);
  }
  function beginMatch(room) {
    room.phase = "playing";
    room.matchId++;
    room.snapshot = null;
    room.tick = -1;
    room.players.forEach(player => { player.seq = -1; player.action = -1; player.socket.snapshot = null; });
    broadcast(room, { type: "start", matchId: room.matchId, teams: room.players.map(player => player.selection), settings: room.settings });
    publish(room);
  }

  sockets.on("connection", socket => {
    socket.alive = true;
    socket.room = null;
    socket.seat = null;
    socket.rate = { start: Date.now(), count: 0 };
    socket.on("pong", () => { socket.alive = true; });
    socket.on("error", () => { socket.terminate(); });
    socket.on("message", (bytes, binary) => {
      try {
        if (binary) throw new Error("Only JSON messages are supported.");
        const now = Date.now();
        if (now - socket.rate.start >= 1000) socket.rate = { start: now, count: 0 };
        if (++socket.rate.count > 100) { socket.close(1008, "Too many messages"); return; }
        const message = JSON.parse(bytes.toString());
        if (!message || message.v !== protocol.version) throw new Error("Reload the game to use the current multiplayer version.");
        if (message.type === "ping") { send(socket, { type: "pong", at: message.at }); return; }
        if (message.type === "create") {
          if (socket.room) throw new Error("Leave your current room first.");
          if (rooms.size >= maxRooms) throw new Error("The server is full. Try again later.");
          const settings = protocol.settings(message.settings);
          let code;
          do { code = Array.from(crypto.randomBytes(6), byte => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32]).join(""); } while (rooms.has(code));
          const room = { code, settings, players: [null, null], phase: "lobby", matchId: 0, snapshot: null, tick: -1, touched: now };
          rooms.set(code, room);
          joinSeat(room, 0, socket);
          return;
        }
        if (message.type === "join") {
          if (socket.room) throw new Error("Leave your current room first.");
          const room = rooms.get(message.code);
          if (!room) throw new Error("Room not found. Check the code.");
          if (room.phase !== "lobby" || room.players[1]) throw new Error("This room is full or already playing.");
          socket.compactSnapshots = message.snapshotFormat === "delta";
          joinSeat(room, 1, socket);
          return;
        }
        if (message.type === "resume") {
          if (socket.room) throw new Error("Already connected to a room.");
          const room = rooms.get(message.code);
          const seat = room?.players.findIndex(player => player && player.token === message.token);
          if (!room || seat === -1) { send(socket, { type: "ended", reason: "Your room expired. Create or join a new room." }); return; }
          const player = room.players[seat];
          socket.compactSnapshots = message.snapshotFormat === "delta";
          if (seat === 0 && room.phase === "playing" && !message.hasSimulation) {
            const reason = "The host reloaded. Create a new match.";
            send(socket, { type: "ended", reason });
            destroyRoom(room, reason); return;
          }
          if (player.socket) {
            player.socket.room = null;
            player.socket.seat = null;
            player.socket.close(4001, "Player reconnected");
          }
          clearTimeout(player.expiry);
          player.socket = socket;
          socket.room = room;
          socket.seat = seat;
          send(socket, { type: "joined", code: room.code, player: seat, token: player.token, resumed: true });
          send(socket, { type: "restore", matchId: room.matchId, teams: room.players.filter(Boolean).map(entry => entry.selection), settings: room.settings, phase: room.phase });
          publish(room);
          if (room.snapshot && send(socket, { type: "snapshot", matchId: room.matchId, snapshot: room.snapshot })) socket.snapshot = room.snapshot;
          return;
        }
        const room = socket.room;
        if (!room || !rooms.has(room.code)) throw new Error("Create or join a room first.");
        room.touched = now;
        const player = room.players[socket.seat];
        if (message.type === "leave") {
          if (socket.seat === 0 || room.phase !== "lobby") destroyRoom(room, "A player left the room.");
          else {
            room.players[1] = null;
            room.players[0].ready = false;
            socket.room = null; socket.seat = null;
            send(socket, { type: "ended", reason: "You left the room." });
            publish(room);
          }
        } else if (message.type === "abort") {
          destroyRoom(room, "The exhibition could not continue. Create a new match.");
        } else if (message.type === "settings") {
          if (socket.seat !== 0 || room.phase !== "lobby") throw new Error("Only the creator can change lobby settings.");
          room.settings = protocol.settings(message.settings);
          room.players.forEach(entry => { if (entry) entry.ready = false; });
          publish(room);
        } else if (message.type === "select") {
          if (room.phase !== "lobby") throw new Error("Team selection is closed.");
          player.selection = protocol.selection(message.selection, catalog);
          room.players.forEach(entry => { if (entry) entry.ready = false; });
          publish(room);
        } else if (message.type === "ready") {
          if (room.phase !== "lobby" || !player.selection || typeof message.ready !== "boolean") throw new Error("Choose a team before getting ready.");
          player.ready = message.ready;
          if (room.players.every(entry => entry?.ready && entry.socket)) beginMatch(room);
          else publish(room);
        } else if (message.type === "input") {
          if (room.phase !== "playing" || message.matchId !== room.matchId || room.players.some(entry => !entry.socket)) return;
          const input = protocol.input(message.input);
          if (input.seq <= player.seq) return;
          player.seq = input.seq;
          input.actions = input.actions.filter(action => {
            if (action.id <= player.action) return false;
            player.action = action.id;
            return true;
          });
          send(room.players[0].socket, { type: "input", player: socket.seat, matchId: room.matchId, input });
        } else if (message.type === "snapshot") {
          if (socket.seat !== 0 || room.phase !== "playing" || message.matchId !== room.matchId) throw new Error("Only the active host can publish match state.");
          if (room.players.some(entry => !entry.socket)) return;
          let snapshot = message.snapshot;
          if (!snapshot || !Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0 || !Array.isArray(snapshot.entities) || snapshot.entities.length > 384 || !Array.isArray(snapshot.score) || snapshot.score.length !== 2 || !snapshot.score.every(score => Number.isInteger(score) && score >= 0 && score <= 999) || ![0, 1].includes(snapshot.possession)) throw new Error("Invalid match state.");
          if (snapshot.tick <= room.tick) return;
          snapshot = protocol.restoreSnapshot(snapshot, room.snapshot);
          if (snapshot.entities.length > 384) throw new Error("Invalid match state.");
          room.tick = snapshot.tick;
          room.snapshot = snapshot;
          const guest = room.players[1].socket;
          if (guest.bufferedAmount <= 64 * 1024) {
            const update = guest.compactSnapshots ? protocol.snapshotDelta(snapshot, guest.snapshot) : snapshot;
            if (send(guest, { type: "snapshot", matchId: room.matchId, snapshot: update }, true)) guest.snapshot = snapshot;
          }
        } else if (message.type === "finished") {
          if (socket.seat !== 0 || room.phase !== "playing" || message.matchId !== room.matchId || !Array.isArray(message.score) || message.score.length !== 2 || !message.score.every(score => Number.isInteger(score) && score >= 0 && score <= 999)) throw new Error("Invalid match result.");
          room.phase = "finished";
          room.players.forEach(entry => { entry.ready = false; });
          broadcast(room, { type: "finished", score: message.score });
          publish(room);
        } else if (message.type === "rematch") {
          if (room.phase !== "finished") throw new Error("Finish the current match first.");
          player.ready = true;
          if (room.players.every(entry => entry.ready && entry.socket)) beginMatch(room);
          else publish(room);
        } else throw new Error("Unknown multiplayer message.");
      } catch (error) { send(socket, { type: "error", message: error instanceof SyntaxError ? "Invalid JSON message." : error.message }); }
    });
    socket.on("close", (code, reason) => {
      const room = socket.room;
      if (!room || !rooms.has(room.code)) return;
      console.log("Player disconnected: seat=" + socket.seat + " code=" + code + " reason=" + reason.toString());
      const player = room.players[socket.seat];
      if (player.socket !== socket) return;
      player.socket = null;
      player.ready = false;
      broadcast(room, { type: "pause", seconds: Math.ceil(reconnectMs / 1000) });
      publish(room);
      player.expiry = setTimeout(() => destroyRoom(room, "A player did not reconnect in time."), reconnectMs);
      player.expiry.unref();
    });
  });
  const heartbeat = setInterval(() => {
    sockets.clients.forEach(socket => {
      if (!socket.alive) { socket.terminate(); return; }
      socket.alive = false;
      socket.ping();
    });
    rooms.forEach(room => { if (room.phase !== "playing" && Date.now() - room.touched > lobbyMs) destroyRoom(room, "Room expired from inactivity."); });
  }, 10000);
  heartbeat.unref();
  function shutdown() {
    clearInterval(heartbeat);
    rooms.forEach(room => destroyRoom(room, "The server restarted. Create a new room."));
    sockets.clients.forEach(socket => socket.close(1001, "Server shutting down"));
    sockets.close();
    server.close();
  }
  return { server, rooms, shutdown };
}

if (require.main === module) {
  const service = createServer({ allowTests: process.env.NODE_ENV === "test" });
  service.server.listen(Number(process.env.PORT) || 3000, "0.0.0.0", () => console.log("Game server listening on port " + service.server.address().port));
  process.on("SIGTERM", service.shutdown);
  process.on("SIGINT", service.shutdown);
}
module.exports = { createServer, catalog };
