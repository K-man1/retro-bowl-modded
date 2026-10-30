"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const { createServer, catalog } = require("../server");
const protocol = require("../multiplayer-protocol");

async function fixture(t, options = {}) {
  const service = createServer(options);
  service.server.listen(0, "127.0.0.1");
  await once(service.server, "listening");
  const url = "http://127.0.0.1:" + service.server.address().port;
  const clients = [];
  t.after(() => { clients.forEach(client => client.socket.terminate()); service.shutdown(); });
  async function connect() {
    const socket = new WebSocket(url.replace("http", "ws") + "/multiplayer");
    const messages = [];
    socket.on("message", bytes => { messages.push(JSON.parse(bytes)); });
    await once(socket, "open");
    const client = {
      socket,
      send(message) { socket.send(JSON.stringify({ v: 1, ...message })); },
      async next(type, predicate = () => true) {
        const expires = Date.now() + 2000;
        while (Date.now() < expires) {
          const index = messages.findIndex(message => message.type === type && predicate(message));
          if (index !== -1) return messages.splice(index, 1)[0];
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error("Timed out waiting for " + type + ": " + JSON.stringify(messages));
      },
      messages
    };
    clients.push(client);
    return client;
  }
  async function pair() {
    const host = await connect();
    host.send({ type: "create", settings: { difficulty: 2, minutes: 1 } });
    const joined = await host.next("joined");
    const guest = await connect();
    guest.send({ type: "join", code: joined.code });
    const guestJoined = await guest.next("joined");
    return { host, guest, joined, guestJoined };
  }
  async function start(pair) {
    for (const client of [pair.host, pair.guest]) {
      client.send({ type: "select", selection: { kind: "regular", teamId: 0 } });
      await client.next("room", message => message.players[client === pair.host ? 0 : 1]?.selection);
    }
    pair.host.send({ type: "ready", ready: true });
    pair.guest.send({ type: "ready", ready: true });
    const started = await pair.host.next("start");
    await pair.guest.next("start");
    return started;
  }
  return { service, url, connect, pair, start };
}

test("serve the game and health without exposing project files", async t => {
  const { url } = await fixture(t);
  assert.deepEqual(await fetch(url + "/health").then(response => response.json()), { status: "ok" });
  assert.equal((await fetch(url)).status, 200);
  for (const filename of [".git/config", "server.js", "package.json", "tests/engine.html", "%2e%2e/server.js"]) {
    assert.equal((await fetch(url + "/" + filename)).status, 404);
  }
});

test("invalid and full rooms, duplicate teams, settings permissions, readiness", async t => {
  const fixtureState = await fixture(t);
  const invalid = await fixtureState.connect();
  invalid.send({ type: "join", code: "XXXXXX" });
  assert.match((await invalid.next("error")).message, /not found/);
  const pair = await fixtureState.pair();
  invalid.send({ type: "join", code: pair.joined.code });
  assert.match((await invalid.next("error")).message, /full/);
  pair.guest.send({ type: "settings", settings: { difficulty: 4, minutes: 3 } });
  assert.match((await pair.guest.next("error")).message, /creator/);
  pair.host.send({ type: "ready", ready: true });
  assert.match((await pair.host.next("error")).message, /Choose a team/);
  const started = await fixtureState.start(pair);
  assert.equal(started.teams[0].team.uid, started.teams[1].team.uid);
  assert.equal(started.matchId, 1);
});

test("validate career fields and exclude unrelated saved information", () => {
  const selection = protocol.selection({ kind: "career", team: { ...catalog[0], secret: "unused" }, roster: [{ position: 1, fname: "Pat", lname: "Smith", skill: 8, speed: 6, strength: 7, stamina: 9, salary: 99 }] }, catalog);
  assert.equal(selection.team.secret, undefined);
  assert.equal(selection.roster[0].salary, undefined);
  assert.equal(selection.roster[0].skill, 8);
  assert.throws(() => protocol.selection({ kind: "career", team: catalog[0], roster: [{ position: 1, skill: Infinity }] }, catalog));
  assert.throws(() => protocol.input({ seq: 1, keys: [10000], pointer: { x: 0, y: 0, down: false } }));
});

test("sequence inputs and actions, restrict snapshot publishing, isolate rooms", async t => {
  const f = await fixture(t);
  const pair = await f.pair();
  const other = await f.pair();
  const started = await f.start(pair);
  const input = { seq: 1, keys: [68], pointer: { x: 0.5, y: 0.5, down: false }, actions: [{ id: 1, type: "switch" }] };
  pair.guest.send({ type: "input", matchId: started.matchId, input });
  const received = await pair.host.next("input");
  assert.equal(received.player, 1);
  assert.deepEqual(received.input.actions, input.actions);
  pair.guest.send({ type: "input", matchId: started.matchId, input: { ...input, seq: 2 } });
  assert.deepEqual((await pair.host.next("input")).input.actions, []);
  const snapshot = { tick: 1, entities: [], score: [0, 0], possession: 0 };
  pair.guest.send({ type: "snapshot", matchId: started.matchId, snapshot });
  assert.match((await pair.guest.next("error")).message, /host/);
  pair.host.send({ type: "snapshot", matchId: started.matchId, snapshot });
  assert.deepEqual((await pair.guest.next("snapshot")).snapshot, snapshot);
  assert.equal(other.guest.messages.some(message => message.type === "snapshot" || message.type === "input"), false);
});

test("disconnect pauses play and token reconnect restores authoritative state", async t => {
  const f = await fixture(t);
  const pair = await f.pair();
  const started = await f.start(pair);
  const snapshot = { tick: 1, entities: [], score: [3, 0], possession: 1 };
  pair.host.send({ type: "snapshot", matchId: started.matchId, snapshot });
  await pair.guest.next("snapshot");
  pair.guest.socket.close();
  await pair.host.next("pause");
  const reconnect = await f.connect();
  reconnect.send({ type: "resume", code: pair.joined.code, token: pair.guestJoined.token });
  assert.equal((await reconnect.next("joined")).player, 1);
  assert.deepEqual((await reconnect.next("snapshot")).snapshot, snapshot);
  assert.equal((await reconnect.next("room")).paused, false);
});

test("disconnect timeout, host refresh and server restart end matches explicitly", async t => {
  const f = await fixture(t, { reconnectMs: 30 });
  const pair = await f.pair();
  await f.start(pair);
  pair.guest.socket.close();
  assert.match((await pair.host.next("ended")).reason, /reconnect/);
  const second = await f.pair();
  await f.start(second);
  second.host.socket.close();
  await second.guest.next("pause");
  const refresh = await f.connect();
  refresh.send({ type: "resume", code: second.joined.code, token: second.joined.token, hasSimulation: false });
  assert.match((await second.guest.next("ended")).reason, /reloaded/);
  const third = await f.pair();
  f.service.shutdown();
  assert.match((await third.host.next("ended")).reason, /restarted/);
});

test("both players must accept a rematch and old packets cannot enter the new match", async t => {
  const f = await fixture(t);
  const pair = await f.pair();
  const first = await f.start(pair);
  pair.host.send({ type: "finished", matchId: first.matchId, score: [7, 3] });
  await pair.guest.next("finished");
  pair.host.send({ type: "rematch" });
  await pair.host.next("room", message => message.phase === "finished" && message.players[0].ready);
  pair.guest.send({ type: "rematch" });
  const second = await pair.host.next("start");
  assert.equal(second.matchId, first.matchId + 1);
  pair.host.send({ type: "snapshot", matchId: first.matchId, snapshot: { tick: 999, entities: [], score: [9, 9], possession: 0 } });
  assert.match((await pair.host.next("error")).message, /active host/);
});
