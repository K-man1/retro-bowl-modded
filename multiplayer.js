(function () {
  "use strict";
  var socket;
  var room;
  var player = null;
  var token = null;
  var frame;
  var catalog = [];
  var career;
  var matchId = 0;
  var simulation = false;
  var reconnectTimer;
  var reconnectDeadline = 0;
  var intentionalClose = false;
  var active = false;
  var engineReady = false;
  var waitingStart;
  var latestPresentation;
  var queuedSnapshots = [];

  var launch = document.createElement("button");
  launch.id = "online-open";
  launch.type = "button";
  launch.textContent = "ONLINE EXHIBITION";
  document.body.appendChild(launch);
  var panel = document.createElement("section");
  panel.id = "online-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Online exhibition");
  panel.innerHTML = '<div id="online-lobby">' +
    '<h1>ONLINE EXHIBITION</h1><div id="online-connect">' +
    '<p>Play a friend on another computer. One player controls offense and the other controls a defender.</p>' +
    '<button id="online-create" type="button" disabled>CREATE ROOM</button>' +
    '<label for="online-code">ROOM CODE</label><input id="online-code" maxlength="6" autocomplete="off" spellcheck="false">' +
    '<button id="online-join" type="button" disabled>JOIN ROOM</button></div>' +
    '<div id="online-room" hidden><p>ROOM CODE</p><div id="online-room-code"></div>' +
    '<label for="online-invite">INVITE LINK</label><input id="online-invite" readonly>' +
    '<button id="online-copy" type="button">COPY INVITE</button>' +
    '<label for="online-team">YOUR TEAM</label><select id="online-team"></select>' +
    '<div class="online-row"><label for="online-difficulty">DIFFICULTY<select id="online-difficulty"><option value="0">DYNAMIC</option><option value="1">EASY</option><option value="2" selected>MEDIUM</option><option value="3">HARD</option><option value="4">EXTREME</option></select></label>' +
    '<label for="online-minutes">QUARTER LENGTH<select id="online-minutes"><option value="1">1 MINUTE</option><option value="2" selected>2 MINUTES</option><option value="3">3 MINUTES</option></select></label></div>' +
    '<div id="online-players"></div><button id="online-ready" type="button">READY</button></div>' +
    '<p>Defense: WASD / arrows to move, Q to switch, Space to dive. Keep the creator’s game open.</p>' +
    '<button id="online-close" type="button">BACK TO GAME</button></div>' +
    '<div id="online-matchbar" hidden><button id="online-room-toggle" type="button">ROOM</button><div id="online-matchmenu" hidden><p id="online-role"></p><p>Defense: WASD / arrows, Q to switch, Space to dive.</p><button id="online-continue" type="button">CONTINUE / SPACE</button> <button id="online-audible" type="button">AUDIBLE</button> <button id="online-timeout" type="button">TIMEOUT</button> <button id="online-leave" type="button">LEAVE</button></div></div>' +
    '<div id="online-finish" hidden><h1 id="online-result">FINAL SCORE</h1><p id="online-score"></p><button id="online-rematch" type="button">REMATCH</button> <button id="online-exit" type="button">LEAVE</button></div>' +
    '<p id="online-status" role="status" aria-live="polite"></p>';
  document.body.appendChild(panel);
  var careerStep = window._8j5;
  window._8j5 = function () { if (!active) return careerStep.apply(window, arguments); };
  function element(id) { return document.getElementById("online-" + id); }
  function status(message) { element("status").textContent = message; element("status").hidden = !message; }
  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(Object.assign({ v: 1 }, message)));
    else status("Connecting to the room server...");
  }
  function engine(message) {
    if (frame) frame.contentWindow.postMessage(Object.assign({ source: "retro-lobby" }, message), location.origin);
  }
  function settings() { return { difficulty: Number(element("difficulty").value), minutes: Number(element("minutes").value) }; }
  function selection() {
    if (element("team").value === "career") return Object.assign({ kind: "career" }, career);
    return { kind: "regular", teamId: Number(element("team").value) };
  }
  function populateTeams() {
    var select = element("team");
    select.replaceChildren();
    catalog.forEach(function (team) {
      var option = document.createElement("option");
      option.value = String(team.uid);
      option.textContent = team.name;
      select.appendChild(option);
    });
    if (career) {
      var option = document.createElement("option");
      option.value = "career";
      option.textContent = "CAREER: " + career.team.name;
      select.appendChild(option);
    }
  }
  function createFrame() {
    engineReady = false;
    frame = document.createElement("iframe");
    frame.id = "online-frame";
    frame.title = "Online exhibition game";
    frame.hidden = true;
    frame.src = "multiplayer-frame.html";
    panel.prepend(frame);
  }
  function start(message) {
    if (!engineReady) { waitingStart = message; return; }
    matchId = message.matchId;
    simulation = player === 0;
    latestPresentation = null;
    panel.classList.add("playing");
    element("lobby").hidden = true;
    element("matchbar").hidden = false;
    element("finish").hidden = true;
    element("matchmenu").hidden = true;
    frame.hidden = false;
    status("Starting exhibition...");
    engine({ type: "start", teams: message.teams, settings: message.settings, player: player });
    queuedSnapshots.forEach(function (snapshot) { if (snapshot.matchId === matchId) engine(snapshot); });
    queuedSnapshots = [];
    frame.focus();
  }
  function showRoom(message) {
    room = message;
    element("connect").hidden = true;
    element("room").hidden = false;
    element("room-code").textContent = message.code;
    var invite = new URL(location.href);
    invite.search = "";
    invite.hash = "room=" + message.code;
    element("invite").value = invite.href;
    element("difficulty").value = String(message.settings.difficulty);
    element("minutes").value = String(message.settings.minutes);
    element("difficulty").disabled = player !== 0;
    element("minutes").disabled = player !== 0;
    element("players").replaceChildren();
    message.players.forEach(function (entry, index) {
      var line = document.createElement("p");
      line.textContent = "PLAYER " + (index + 1) + (index === player ? " (YOU)" : "") + ": " + (!entry ? "WAITING FOR FRIEND" : !entry.connected ? "RECONNECTING" : (entry.selection ? entry.selection.team.name : "CHOOSING TEAM") + (entry.ready ? " / READY" : " / NOT READY"));
      element("players").appendChild(line);
    });
    var me = message.players[player];
    if (message.phase === "lobby" && me?.selection) element("team").value = me.selection.kind === "career" ? "career" : String(me.selection.team.uid);
    element("ready").textContent = me && me.ready ? "NOT READY" : "READY";
    element("ready").disabled = !me || !me.selection;
    if (message.phase === "playing") {
      engine({ type: "pause", paused: message.paused });
      if (message.paused) status("Connection lost. Waiting up to 30 seconds for your friend...");
      else if (latestPresentation) showPresentation(latestPresentation);
    } else if (message.phase === "lobby") status("Share the room code, choose your teams, then both press READY.");
    if (message.phase === "finished") element("rematch").disabled = Boolean(me && me.ready);
  }
  function showPresentation(message) {
    if (!room || room.phase !== "playing") return;
    latestPresentation = message;
    var offense = message.possession === player;
    var clock = message.clock;
    element("role").textContent = (offense ? "OFFENSE" : "DEFENSE") + " / " + message.score.join(" - ") + " / " + (clock[0] > 4 ? "OT" : "Q" + clock[0]) + " " + clock[1] + ":" + String(clock[2]).padStart(2, "0");
    ["continue", "audible", "timeout"].forEach(function (id) { element(id).disabled = !offense || Boolean(room && room.paused); });
    if (!room.paused) status("");
  }
  function finish(message) {
    engine({ type: "pause", paused: true });
    element("finish").hidden = false;
    element("result").textContent = "FINAL SCORE";
    element("score").textContent = message.score.join(" - ");
    element("rematch").hidden = false;
    element("rematch").disabled = false;
    status("Both players can choose REMATCH to play again.");
  }
  function ended(reason) {
    simulation = false;
    token = null;
    room = null;
    waitingStart = null;
    queuedSnapshots = [];
    reconnectDeadline = 0;
    sessionStorage.removeItem("retro-online-room");
    engine({ type: "pause", paused: true });
    if (panel.classList.contains("playing")) {
      element("finish").hidden = false;
      element("result").textContent = "MATCH ENDED";
      element("score").textContent = reason;
      element("rematch").hidden = true;
    } else {
      element("room").hidden = true;
      element("connect").hidden = false;
    }
    status(reason);
  }
  function connect(resume) {
    clearTimeout(reconnectTimer);
    intentionalClose = false;
    socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/multiplayer");
    socket.addEventListener("open", function () {
      if (!active) { socket.close(); return; }
      element("create").disabled = !engineReady;
      element("join").disabled = !engineReady;
      if (resume && token) send({ type: "resume", code: resume, token: token, hasSimulation: simulation, snapshotFormat: "delta" });
      else status("Choose CREATE ROOM or enter your friend’s code.");
    });
    socket.addEventListener("message", function (event) {
      var message = JSON.parse(event.data);
      if (message.v !== 1) { ended("Multiplayer version changed. Reload the game."); return; }
      if (message.type === "joined") {
        player = message.player;
        token = message.token;
        reconnectDeadline = 0;
        sessionStorage.setItem("retro-online-room", JSON.stringify({ code: message.code, token: token, player: player }));
        if (!message.resumed) send({ type: "select", selection: selection() });
      }
      if (message.type === "room") showRoom(message);
      if (message.type === "start") start(message);
      if (message.type === "restore" && message.phase === "playing" && player === 1 && !panel.classList.contains("playing")) start(message);
      if (message.type === "input" && player === 0 && message.player === 1 && message.matchId === matchId) engine(message);
      if (message.type === "snapshot" && player === 1) {
        if (engineReady && message.matchId === matchId) engine(message);
        else if (waitingStart?.matchId === message.matchId) queuedSnapshots.push(message);
      }
      if (message.type === "pause") { engine({ type: "pause", paused: true }); status("Connection lost. Waiting up to " + message.seconds + " seconds..."); }
      if (message.type === "finished") finish(message);
      if (message.type === "ended") ended(message.reason);
      if (message.type === "error") status(message.message);
    });
    socket.addEventListener("close", function (event) {
      element("create").disabled = true;
      element("join").disabled = true;
      if (intentionalClose || !active) return;
      if (event.code === 4001) { ended("Your room was opened in another connection."); return; }
      engine({ type: "pause", paused: true });
      if (!token || !room) { status("Cannot connect to the room server. Reload and try again."); return; }
      if (!reconnectDeadline) reconnectDeadline = Date.now() + 30000;
      if (Date.now() >= reconnectDeadline) { ended("Unable to reconnect. Create a new room."); return; }
      status("Reconnecting to your room...");
      reconnectTimer = setTimeout(function () { connect(room.code); }, 1000);
    });
    socket.addEventListener("error", function () { status("Room server unavailable. It may still be starting..."); });
  }
  function open() {
    active = true;
    panel.hidden = false;
    launch.hidden = true;
    if (typeof window._cg4 === "boolean") window._cg4 = true;
    document.getElementById("jax-panel").classList.remove("open");
    document.getElementById("jax-dimmer").classList.remove("visible");
    status("Loading teams and connecting to the room server...");
    createFrame();
    var resume = sessionStorage.getItem("retro-online-room");
    if (resume) {
      var saved = JSON.parse(resume);
      token = saved.token;
      player = saved.player;
      connect(saved.code);
    } else connect();
    var code = new URLSearchParams(location.hash.slice(1)).get("room");
    if (code) element("code").value = code.toUpperCase();
  }
  function close() {
    if (room) send({ type: "leave" });
    active = false;
    intentionalClose = true;
    clearTimeout(reconnectTimer);
    if (socket) socket.close();
    if (frame) frame.remove();
    frame = null;
    waitingStart = null;
    queuedSnapshots = [];
    token = null;
    room = null;
    simulation = false;
    sessionStorage.removeItem("retro-online-room");
    panel.hidden = true;
    panel.classList.remove("playing");
    element("lobby").hidden = false;
    element("connect").hidden = false;
    element("room").hidden = true;
    element("matchbar").hidden = true;
    element("finish").hidden = true;
    element("matchmenu").hidden = true;
    launch.hidden = false;
    if (typeof window._cg4 === "boolean") window._cg4 = false;
  }
  window.addEventListener("message", function (event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || !event.data || event.data.source !== "retro-exhibition") return;
    var message = event.data;
    if (message.type === "catalog") {
      catalog = message.teams;
      career = message.career;
      populateTeams();
      engineReady = true;
      element("create").disabled = !socket || socket.readyState !== WebSocket.OPEN;
      element("join").disabled = element("create").disabled;
      if (waitingStart) { start(waitingStart); waitingStart = null; }
    }
    if (message.type === "local-input" && player === 1) send({ type: "input", matchId: matchId, input: message.input });
    if (message.type === "snapshot" && player === 0 && socket?.readyState === WebSocket.OPEN && socket.bufferedAmount <= 64 * 1024) send({ type: "snapshot", matchId: matchId, snapshot: message.snapshot });
    if (message.type === "presentation") showPresentation(message);
    if (message.type === "finished" && player === 0) send({ type: "finished", matchId: matchId, score: message.score });
    if (message.type === "started") { frame.focus(); if (room?.paused) engine({ type: "pause", paused: true }); }
    if (message.type === "error") {
      engine({ type: "pause", paused: true });
      status("Exhibition error: " + message.message);
      if (room) send({ type: "abort" });
    }
  });
  launch.addEventListener("click", open);
  ["close", "leave", "exit"].forEach(function (id) { element(id).addEventListener("click", close); });
  element("create").addEventListener("click", function () { send({ type: "create", settings: settings() }); });
  element("join").addEventListener("click", function () { send({ type: "join", code: element("code").value.trim().toUpperCase(), snapshotFormat: "delta" }); });
  element("copy").addEventListener("click", async function () {
    try { await navigator.clipboard.writeText(element("invite").value); status("Invite link copied."); }
    catch { element("invite").select(); status("Select and copy the invite link above."); }
  });
  element("team").addEventListener("change", function () { send({ type: "select", selection: selection() }); });
  ["difficulty", "minutes"].forEach(function (id) { element(id).addEventListener("change", function () { if (room && player === 0) send({ type: "settings", settings: settings() }); }); });
  element("ready").addEventListener("click", function () { send({ type: "ready", ready: !room.players[player].ready }); });
  element("rematch").addEventListener("click", function () { send({ type: "rematch" }); });
  element("room-toggle").addEventListener("click", function () { element("matchmenu").hidden = !element("matchmenu").hidden; });
  ["continue", "audible", "timeout"].forEach(function (id) {
    element(id).addEventListener("click", function () { engine({ type: "action", action: id === "continue" ? "space" : id }); frame.focus(); });
  });
  window.addEventListener("keydown", function (event) { if (active) event.stopImmediatePropagation(); }, true);
  setInterval(function () { if (active && socket?.readyState === WebSocket.OPEN) send({ type: "ping", at: Date.now() }); }, 5000);
  setInterval(function () {
    if (active && player === 0) engine({ type: "network", congested: !socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 64 * 1024 });
  }, 100);
  if (new URLSearchParams(location.hash.slice(1)).has("room")) window.addEventListener("load", open);
})();
