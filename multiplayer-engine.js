(function () {
  "use strict";

  window.cpd = undefined;
  window.PokiSDK = null;
  window.PokiSDK_OK = false;
  window.RetroExhibition = true;

  // The engine uses both property access and Storage methods. Neither may reach career saves.
  var careerSave = localStorage.getItem("RetroBowl.0.savedata.ini") || localStorage.getItem("RetroBowlModded.0.savedata.ini");
  var memory = Object.create(null);
  Object.defineProperties(memory, {
    getItem: { value: function (key) { return memory[key] === undefined ? null : memory[key]; } },
    setItem: { value: function (key, text) { memory[key] = String(text); } },
    removeItem: { value: function (key) { delete memory[key]; } },
    key: { value: function (index) { return Object.keys(memory)[index] || null; } },
    length: { get: function () { return Object.keys(memory).length; } }
  });
  Object.defineProperty(window, "localStorage", { value: memory });

  var scripts = {};
  var originals = {};
  var controller;
  var selections = [];
  var rosterLists = [];
  var teamMaps = [];
  var selectedDefender = null;
  var running = false;
  var finished = false;
  var paused = false;
  var localTest = new URLSearchParams(location.search).has("local");
  function emptyInput() { return { keys: [], pointer: { x: 0.5, y: 0.5, down: false } }; }
  var inputs = [emptyInput(), emptyInput()];
  var actionQueues = [[], []];
  var pointerEdges = [[], []];
  var lastInputAt = [0, 0];
  var localPlayer = 0;
  var onEvent = function (event) { parent.postMessage(Object.assign({ source: "retro-exhibition" }, event), location.origin); };
  var status = document.getElementById("engine-status");
  var prompt = null;
  var promptCallbacks = [];
  var promptSerial = 0;
  var mode = "host";
  var sceneReady = false;
  var snapshotTick = 0;
  var appliedTick = -1;
  var mirror = new Map();
  var snapshotBuffer = [];
  var pendingSnapshot = null;
  var pressed = new Set();
  var pointer = { x: 0.5, y: 0.5, down: false };
  var localActions = [];
  var actionId = 0;
  var inputSequence = 0;
  var mouseReleased = false;
  var lastMouseDown = false;
  var entityTypes = [71, 2, 4, 11, 38, 46, 47, 74, 75, 77, 78, 79, 80, 81, 82, 84, 85, 86, 87, 88, 89];
  var gameFields;
  var errorReported = false;
  var visualFields = new Set(["x", "y", "__T", "_K11", "_UR", "_oW", "_753", "_sr2", "_Ca", "_g2"]);
  var omittedFields = new Set(["id", "_3M2", "_7j", "_Fj", "_be1", "_rk1", "_W01"]);
  var instanceFields = new Set(["_X_", "_021", "_l31", "_X31", "_Y31"]);

  function instances(type) { return Object.values(window._si(type) || {}).filter(Boolean); }
  function match() { return instances(71)[0]; }
  function mapFields(handle) { return Object.assign({}, window._fg2._Ue2(handle)); }
  function makeMap(fields) {
    var handle = window._du();
    Object.keys(fields).forEach(function (key) { window._Yi(handle, key, fields[key]); });
    return handle;
  }
  function call(name) {
    return window[scripts[name]].apply(window, Array.prototype.slice.call(arguments, 1));
  }
  function hook(name, replacement) {
    var symbol = scripts[name];
    if (!symbol || typeof window[symbol] !== "function") throw new Error("Missing engine script: " + name);
    originals[name] = window[symbol];
    window[symbol] = replacement;
  }
  function original(name, args) { return originals[name].apply(window, args); }

  var teamFields = ["uid", "name", "tla", "offense", "defense", "colhelmet", "colshirt", "colpants", "coltertiary", "roof", "rainfall", "snowfall", "helmet"];
  var playerFields = ["uid", "fname", "lname", "position", "skill", "strength", "speed", "stamina", "max_skill", "max_strength", "max_speed", "max_stamina", "condition", "resting", "backup", "face", "face_x", "face_y", "skin", "hair", "age", "morale"];
  function extract(fields, handle) {
    var entry = {};
    fields.forEach(function (key) {
      var value = window._Ai(handle, key);
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") entry[key] = value;
    });
    return entry;
  }
  function exportCareer() {
    return {
      team: extract(teamFields, controller._Gp),
      roster: Array.from({ length: window._wi(controller._Ln) }, function (_, index) {
        return extract(playerFields, window._zi(controller._Ln, index));
      })
    };
  }

  function chooseOffense(side) {
    var game = match();
    game._0z = side;
    controller._5Q = side;
    controller._Gp = teamMaps[side];
    controller._Ln = rosterLists[side];
    selectedDefender = null;
    inputs = [emptyInput(), emptyInput()];
    actionQueues = [[], []];
    pointerEdges = [[], []];
    lastMouseDown = false;
    mouseReleased = false;
  }

  function setupExhibition(teams, options) {
    var previousMatch = match();
    sceneReady = false;
    mirror.clear();
    snapshotBuffer = [];
    pendingSnapshot = null;
    snapshotTick = 0;
    appliedTick = -1;
    errorReported = false;
    inputSequence = 0;
    actionId = 0;
    localActions = [];
    selections = teams;
    rosterLists = teams.map(function (selection) {
      var list = window._4j();
      selection.roster.forEach(function (player) {
        var fields = Object.assign({ condition: 100, resting: 0, backup: 0, morale: 100 }, player);
        // Career stat routines expect these counters even for a roster imported from another device.
        var template = window._wi(controller._Ln) ? mapFields(window._zi(controller._Ln, 0)) : {};
        Object.keys(template).filter(function (key) { return key.indexOf("stat_") === 0; }).forEach(function (key) { fields[key] = 0; });
        window._8j(list, makeMap(fields));
      });
      return list;
    });
    teamMaps = teams.map(function (selection) {
      var base = window._dJ(controller, controller, selection.team.uid);
      var fields = Object.assign(mapFields(base), selection.team);
      return makeMap(fields);
    });
    controller._Fj = teamMaps.slice();
    controller._Gp = teamMaps[0];
    controller._Ln = rosterLists[0];
    controller._5Q = 0;
    controller._fx = 0;
    controller._2t = options.difficulty;
    controller._Ws = options.minutes - 2;
    controller._GK = 1;
    controller._HK = 1;
    controller._fj = 2;
    controller._cn = controller._Lo + 1;
    window._Yi(controller._Gn, "op_drivedir", 0);
    window._Yi(controller._Gn, "op_music", 0);
    window._gx(controller, controller);
    running = true;
    finished = false;
    paused = false;
    prompt = null;
    window._Hj(17);
    var timer = setInterval(function () {
      var game = match();
      if (!game || game === previousMatch) return;
      clearInterval(timer);
      controller._Fj = teamMaps.slice();
      game._Fj = teamMaps.slice();
      game._bL = teams.map(function (selection) { return selection.team.name; });
      game.__41 = teams.map(function (selection) { return selection.team.offense; });
      game._151 = teams.map(function (selection) { return selection.team.defense; });
      window._gx(controller, controller);
      game._dJ1 = controller._It;
      game._eJ1 = controller._Kt;
      game._fJ1 = controller._Mt;
      chooseOffense(game._UD);
      sceneReady = true;
      window._9g4 = false;
      window._cg4 = false;
      status.textContent = "";
      if (pendingSnapshot) applySnapshot(pendingSnapshot);
      onEvent({ type: "started", possession: game._UD });
    }, 20);
  }

  function eligibleDefenders() {
    return instances(75).filter(function (player) { return !player._k31 && ![3, 4, 5, 8, 10].includes(player._g21); });
  }
  function switchDefender() {
    var ball = instances(window.global._d01)[0];
    if (!ball) return;
    var defenders = eligibleDefenders();
    var alternative = defenders.filter(function (player) { return player.id !== selectedDefender; });
    if (alternative.length) defenders = alternative;
    defenders.sort(function (a, b) { return Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y); });
    selectedDefender = defenders.length ? defenders[0].id : null;
  }
  function setInput(side, input) {
    inputs[side] = input;
    lastInputAt[side] = performance.now();
    if (input.actions) {
      input.actions.forEach(function (action) {
        if (action.type === "pointer") {
          if (sceneReady && side === match()._UD) pointerEdges[side].push(action);
        } else actionQueues[side].push(action);
      });
    }
  }
  function defend(player) {
    if (!running || finished || paused) return false;
    var game = match();
    if (!selectedDefender || !eligibleDefenders().some(function (candidate) { return candidate.id === selectedDefender; })) switchDefender();
    if (player.id !== selectedDefender) return false;
    var ball = instances(window.global._d01)[0];
    if (ball._kp === 0 || ball._kp === 1) { player._o71 = 0; return true; }
    var side = 1 - game._UD;
    var keys = performance.now() - lastInputAt[side] < 500 ? inputs[side].keys : [];
    var x = Number(keys.includes(68) || keys.includes(39)) - Number(keys.includes(65) || keys.includes(37));
    var y = Number(keys.includes(83) || keys.includes(40)) - Number(keys.includes(87) || keys.includes(38));
    player._o71 = x || y ? 1 : 0;
    if (x || y) player._541 = window._701(0, 0, x, y);
    return true;
  }

  function camera() {
    var view = window._ft._ZA1[0];
    return [window._bB1(view), window._dB1(view), window._0B1(view), window._2B1(view)];
  }
  function presentation(instance) {
    var fields = {};
    var keys = new Set(Object.keys(instance));
    visualFields.forEach(function (key) { keys.add(key); });
    keys.forEach(function (key) {
      if (!gameFields.has(key) || omittedFields.has(key)) return;
      var descriptor = Object.getOwnPropertyDescriptor(instance, key);
      if (!visualFields.has(key) && (!descriptor || !("value" in descriptor))) return;
      var value = instance[key];
      if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" || typeof value === "string") fields[key] = value;
      // Native aiming uses 50 points, and ball trails use pairs of coordinates.
      else if (Array.isArray(value) && value.length <= 128 && value.every(function (part) {
        return typeof part === "number" && Number.isFinite(part) || typeof part === "string" || Array.isArray(part) && part.length <= 4 && part.every(Number.isFinite);
      })) fields[key] = value.map(function (part) { return Array.isArray(part) ? part.slice() : part; });
    });
    return fields;
  }
  function captureSnapshot() {
    var game = match();
    return {
      tick: snapshotTick++,
      score: game._Sb1.slice(), possession: game._UD, clock: [game._Wy, game._r11, game._s11],
      phase: game._kp, defender: selectedDefender, camera: camera(), prompt: prompt,
      entities: entityTypes.flatMap(function (type) {
        return instances(type).filter(function (instance) { return instance._3M2 === type; }).map(function (instance) {
          var entity = { id: instance.id, type: type, fields: presentation(instance) };
          if ((type === 74 || type === 75) && instance._7j !== -4) entity.player = extract(playerFields, instance._7j);
          return entity;
        });
      })
    };
  }
  function applySnapshot(snapshot) {
    if (!sceneReady) { pendingSnapshot = snapshot; return; }
    var game = match();
    if (!game) return;
    if (appliedTick === snapshot.tick) {
      snapshot.entities.forEach(function (entity) {
        var instance = mirror.get(entity.id);
        if (!instance) return;
        if (Number.isFinite(entity.fields.x)) instance.x = entity.fields.x;
        if (Number.isFinite(entity.fields.y)) instance.y = entity.fields.y;
      });
      var currentView = window._ft._ZA1[0];
      window._eB1(currentView, snapshot.camera[0], snapshot.camera[1]);
      window._YA1(currentView, snapshot.camera[2], snapshot.camera[3]);
      return;
    }
    appliedTick = snapshot.tick;
    if (!mirror.size) {
      entityTypes.forEach(function (type) {
        if (type === 71) return;
        instances(type).forEach(function (instance) { window._cr(instance); });
      });
    }
    var liveIds = new Set(snapshot.entities.map(function (entity) { return entity.id; }));
    mirror.forEach(function (instance, id) {
      if (!liveIds.has(id)) { window._cr(instance); mirror.delete(id); }
    });
    snapshot.entities.forEach(function (entity) {
      if (!entityTypes.includes(entity.type)) throw new Error("Unknown exhibition entity");
      if (mirror.has(entity.id)) return;
      var instance;
      if (entity.type === 71) instance = game;
      else {
        var layer = [4, 11, 38, 46, 47].includes(entity.type) ? "PopUps" : [74, 75, 81, 82].includes(entity.type) ? "Players" : [77, 78].includes(entity.type) ? "Ball" : [84, 85, 86].includes(entity.type) ? "Weather" : "Text";
        // Weather create events discard particles according to the guest's local weather setting.
        if ([84, 85, 86].includes(entity.type)) instance = window._Sc2._GR2(0, 0, window._zM2._AM2(window._Sc2, layer), entity.type);
        else {
          var id = window._dr(0, 0, layer, entity.type);
          instance = instances(id)[0];
        }
        if (!instance) throw new Error("Unable to mirror native entity " + entity.type);
      }
      mirror.set(entity.id, instance);
      if (entity.type === 77) window.global._d01 = instance.id;
    });
    controller._5Q = snapshot.possession;
    controller._Gp = teamMaps[snapshot.possession];
    controller._Ln = rosterLists[snapshot.possession];
    snapshot.entities.forEach(function (entity) {
      var instance = mirror.get(entity.id);
      Object.keys(entity.fields).forEach(function (key) {
        if (!gameFields.has(key) || omittedFields.has(key)) return;
        var value = entity.fields[key];
        if (instanceFields.has(key) && mirror.has(value)) value = mirror.get(value).id;
        var descriptor = Object.getOwnPropertyDescriptor(instance, key);
        var unchanged = descriptor && "value" in descriptor ? descriptor.value === value : visualFields.has(key) && instance[key] === value;
        if (!unchanged && (typeof value === "number" || typeof value === "string" || typeof value === "boolean" || Array.isArray(value))) instance[key] = value;
      });
      if (entity.player && instance._onlinePlayer === undefined) {
        instance._onlinePlayer = makeMap(entity.player);
        instance._7j = instance._onlinePlayer;
      }
      if (entity.type === 77) window.global._d01 = instance.id;
    });
    var view = window._ft._ZA1[0];
    window._eB1(view, snapshot.camera[0], snapshot.camera[1]);
    window._YA1(view, snapshot.camera[2], snapshot.camera[3]);
    selectedDefender = snapshot.defender;
    prompt = snapshot.prompt;
    onEvent({ type: "presentation", possession: snapshot.possession, score: snapshot.score, clock: snapshot.clock, prompt: snapshot.prompt });
  }
  function receiveSnapshot(snapshot) {
    if (snapshotBuffer.length && snapshot.tick <= snapshotBuffer[snapshotBuffer.length - 1].snapshot.tick) return;
    snapshotBuffer.push({ received: performance.now(), snapshot: snapshot });
    if (snapshotBuffer.length > 8) snapshotBuffer.shift();
    if (!sceneReady) pendingSnapshot = snapshot;
  }
  function interpolateSnapshot() {
    if (!snapshotBuffer.length) return;
    var target = performance.now() - 50;
    while (snapshotBuffer.length > 2 && snapshotBuffer[1].received <= target) snapshotBuffer.shift();
    var earlier = snapshotBuffer[0];
    var later = snapshotBuffer[1];
    if (!later || earlier.snapshot.possession !== later.snapshot.possession || earlier.snapshot.phase !== later.snapshot.phase) {
      applySnapshot(earlier.snapshot);
      return;
    }
    var blend = Math.max(0, Math.min(1, (target - earlier.received) / (later.received - earlier.received)));
    var previous = new Map(earlier.snapshot.entities.map(function (entity) { return [entity.id, entity]; }));
    var interpolated = Object.assign({}, later.snapshot, {
      camera: later.snapshot.camera.map(function (coordinate, index) { return earlier.snapshot.camera[index] + (coordinate - earlier.snapshot.camera[index]) * blend; }),
      entities: later.snapshot.entities.map(function (entity) {
      var before = previous.get(entity.id);
      if (!before) return entity;
      var fields = Object.assign({}, entity.fields);
      ["x", "y"].forEach(function (key) { fields[key] = before.fields[key] + (fields[key] - before.fields[key]) * blend; });
      return Object.assign({}, entity, { fields: fields });
    }) });
    applySnapshot(interpolated);
  }
  function offensiveInput() {
    var side = match()._UD;
    return performance.now() - lastInputAt[side] < 500 ? inputs[side] : { keys: [], pointer: { x: 0.5, y: 0.5, down: false } };
  }
  function handleActions() {
    var game = match();
    if (prompt && mouseReleased) {
      var mouse = offensiveInput().pointer;
      var x = mouse.x * window._Qy();
      var y = mouse.y * window._NF();
      var button = instances(4).concat(instances(11)).find(function (candidate) {
        return candidate._g2 && x >= candidate.x && x <= candidate.x + candidate._8l1 && y >= candidate.y && y <= candidate.y + candidate._VI;
      });
      if (button) {
        var callback = button._0G;
        prompt = null;
        window._li(game, game, callback);
      }
    }
    [0, 1].forEach(function (side) {
      var actions = actionQueues[side].splice(0);
      actions.forEach(function (action) {
        if (side !== game._UD) {
          if (action.type === "switch") switchDefender();
          if (action.type === "space") {
            var defender = eligibleDefenders().find(function (candidate) { return candidate.id === selectedDefender; });
            var ball = instances(window.global._d01)[0];
            if (defender && ball && ball._kp !== 0 && ball._kp !== 1) window._Z01(defender, defender, 5);
          }
          return;
        }
        if (action.type === "choice" && prompt && action.prompt === prompt.id) {
          var callback = promptCallbacks[action.choice];
          prompt = null;
          if (typeof callback === "number") window._Y._PU1[callback - 100000](game, game);
        }
        if (prompt) return;
        if (action.type === "space") {
          if (game._kp === 1) game._7z = true;
          else if (game._kp === 2 && game._UU[0] <= 0) window._eb1(game, game, 1);
        }
        if (action.type === "audible" && game._kp === 2) call("s_do_audible", game, game);
        if (action.type === "timeout") call("s_do_timeout", game, game);
      });
    });
  }

  function installHooks() {
    gameFields = new Set(Object.values(window._aF2).concat(Array.from(visualFields)));
    window._Y._OU1.forEach(function (name, index) {
      if (name.indexOf("gml_Script_") === 0) scripts[name.slice(11)] = window._Y._PU1[index].name;
    });
    hook("s_savegame", function () {});
    var sortRoster = window._AH;
    window._AH = function (self, other, list) {
      var side = rosterLists.indexOf(list);
      var sorted = sortRoster.apply(window, arguments);
      // Sorting replaces and destroys the native list, so possession must retain its new handle.
      if (side !== -1) rosterLists[side] = sorted;
      return sorted;
    };
    hook("s_end_match", function () {
      finished = true;
      onEvent({ type: "finished", score: match()._Sb1.slice() });
    });
    hook("s_change_possession", function () {
      var before = match()._UD;
      var result = original("s_change_possession", arguments);
      if (running && match()._UD !== before) {
        call("s_switch_drivedirection", match(), match());
        chooseOffense(match()._UD);
      }
      return result;
    });
    hook("s_update_commentary", function (game) {
      if (running && game._Vy === 3) {
        // Both teams take the human action path; the original away path simulates a whole drive.
        if (game._0z !== game._UD) chooseOffense(game._UD);
        game._8c1 = Math.max(1, game._8c1);
      }
      return original("s_update_commentary", arguments);
    });
    var findPlayer = window._a51;
    window._a51 = function (self, other, position, number) {
      if (!running || !self || self._lT !== false && self._lT !== 0) return findPlayer.apply(window, arguments);
      var game = match();
      var list = controller._Ln;
      controller._Ln = rosterLists[1 - game._UD];
      try { return findPlayer.apply(window, arguments); }
      finally { controller._Ln = list; }
    };
    var message = window._wm;
    window._wm = function (self, other, title, text, first, second, firstCallback, secondCallback) {
      if (!running) return message.apply(window, arguments);
      promptCallbacks = [firstCallback, secondCallback];
      prompt = { id: ++promptSerial, text: text, options: [first, second], player: match()._UD };
      return message.apply(window, arguments);
    };
    hook("s_aim_AI_defense", function (player) {
      if (!defend(player)) return original("s_aim_AI_defense", arguments);
    });
    var aim = window._Z71;
    window._Z71 = function (player) {
      if (!player._lT && defend(player)) return;
      return aim.apply(window, arguments);
    };
    var nativeKey = window._b81;
    window._b81 = function (code) { return running && sceneReady ? offensiveInput().keys.includes(code) : nativeKey(code); };
    var nativeDown = window._q01;
    window._q01 = function (button) { return running && sceneReady ? button === 1 && offensiveInput().pointer.down : nativeDown(button); };
    var nativeRelease = window._l11;
    window._l11 = function (button) { return running && sceneReady ? button === 1 && mouseReleased : nativeRelease(button); };
    var nativeMouseX = window._m01;
    var nativeMouseY = window._o01;
    window._m01 = function (device) { return running && sceneReady ? offensiveInput().pointer.x * window._Qy() : nativeMouseX(device); };
    window._o01 = function (device) { return running && sceneReady ? offensiveInput().pointer.y * window._NF() : nativeMouseY(device); };
    var nativeWorldX = window._N53;
    var nativeWorldY = window._O53;
    window._N53 = function () { var view = running && sceneReady ? camera() : null; return view ? view[0] + offensiveInput().pointer.x * view[2] : nativeWorldX(); };
    window._O53 = function () { var view = running && sceneReady ? camera() : null; return view ? view[1] + offensiveInput().pointer.y * view[3] : nativeWorldY(); };
    var drawSprite = window._mh1;
    window._mh1 = function (instance, sprite) {
      var defenderId = mode === "guest" && mirror.has(selectedDefender) ? mirror.get(selectedDefender).id : selectedDefender;
      if (running && instance.id === defenderId && sprite === instance.__T) drawSprite(instance, 64, 0, instance.x, instance.y, 2.5, 2.5, 0, 65535, 1);
      return drawSprite.apply(window, arguments);
    };
    var update = window._8j5;
    window._8j5 = function () {
      if (running && sceneReady) {
        if (mode === "guest") {
          if (!paused) interpolateSnapshot();
          window._Sc2._D35();
          window._Sc2._Ch2();
          return;
        }
        // A click can begin and end between two network packets. Present each edge to the engine.
        var edge = pointerEdges[match()._UD].shift();
        if (edge) inputs[match()._UD].pointer = { x: edge.x, y: edge.y, down: edge.down };
        mouseReleased = lastMouseDown && !offensiveInput().pointer.down;
        lastMouseDown = offensiveInput().pointer.down;
        if (!paused && !finished) handleActions();
        if (paused || finished || prompt) {
          window._Sc2._D35();
          window._Sc2._Ch2();
          return;
        }
      }
      return update.apply(window, arguments);
    };
  }

  function reportError(error) {
    if (errorReported) return;
    errorReported = true;
    paused = true;
    window._cg4 = true;
    var message = error.message || error._4D2 || String(error);
    status.textContent = message;
    onEvent({ type: "error", message: message });
    console.error(message, error.stack || JSON.stringify(error._6D2));
  }
  window.addEventListener("error", function (event) { if (running) reportError(event.error || new Error(event.message)); });

  window.addEventListener("message", function (event) {
    if (event.origin !== location.origin || event.source !== parent || !event.data || event.data.source !== "retro-lobby") return;
    var message = event.data;
    if (message.type === "start") {
      localPlayer = message.player;
      mode = localPlayer === 0 ? "host" : "guest";
      setupExhibition(message.teams, message.settings);
    }
    if (message.type === "input") setInput(message.player, message.input);
    if (message.type === "snapshot") receiveSnapshot(message.snapshot);
    if (message.type === "action") localActions.push({ id: actionId++, type: message.action, prompt: message.prompt, choice: message.choice });
    if (message.type === "pause") {
      if (paused === message.paused) return;
      paused = message.paused;
      pressed.clear();
      pointer.down = false;
      inputs = [{ keys: [], pointer: { x: 0.5, y: 0.5, down: false } }, { keys: [], pointer: { x: 0.5, y: 0.5, down: false } }];
      actionQueues = [[], []];
      pointerEdges = [[], []];
      lastMouseDown = false;
      mouseReleased = false;
      localActions = [];
      if (!paused && match()) match()._Hd1 = window._ft._ZB();
    }
  });

  function collectInput() {
    if (!running || !sceneReady || paused || finished) return;
    var input = { seq: inputSequence++, keys: Array.from(pressed), pointer: Object.assign({}, pointer), actions: localActions.splice(0) };
    if (mode === "host") setInput(localPlayer, input);
    onEvent({ type: "local-input", input: input });
  }
  ["keydown", "keyup"].forEach(function (type) {
    window.addEventListener(type, function (event) {
      if (!running) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      var code = event.keyCode;
      if (type === "keydown") {
        if ([87, 65, 83, 68, 37, 38, 39, 40, 32].includes(code)) pressed.add(code);
        if (!event.repeat && [32, 81].includes(code)) localActions.push({ id: actionId++, type: code === 81 ? "switch" : "space" });
      } else pressed.delete(code);
    }, true);
  });
  ["pointermove", "pointerdown", "pointerup"].forEach(function (type) {
    window.addEventListener(type, function (event) {
      if (!running || event.target.id !== "canvas") return;
      event.stopImmediatePropagation();
      var bounds = event.target.getBoundingClientRect();
      pointer.x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      pointer.y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      if (type === "pointerdown") { pointer.down = true; event.target.setPointerCapture(event.pointerId); }
      if (type === "pointerup") pointer.down = false;
      if (type !== "pointermove") localActions.push({ id: actionId++, type: "pointer", x: pointer.x, y: pointer.y, down: pointer.down });
    }, true);
  });
  window.addEventListener("blur", function () { pressed.clear(); pointer.down = false; });
  setInterval(collectInput, 34);
  setInterval(function () {
    if (!running || !sceneReady || mode !== "host" || paused || finished) return;
    var snapshot = captureSnapshot();
    onEvent({ type: "snapshot", snapshot: snapshot });
    onEvent({ type: "presentation", possession: snapshot.possession, score: snapshot.score, clock: snapshot.clock, prompt: prompt });
  }, 50);

  window.addEventListener("load", async function () {
    try {
      var starter = await fetch("saves/starter.json").then(function (response) { if (!response.ok) throw new Error("Unable to load exhibition data"); return response.json(); });
      Object.assign(memory, starter.localStorage);
      if (careerSave) memory["RetroBowl.0.savedata.ini"] = careerSave;
      window.GameMaker_Init();
      var booted = false;
      var poll = setInterval(function () {
        if (booted || typeof window._si !== "function" || !window._fg2) return;
        controller = instances(64)[0];
        if (!controller || controller._Gn === undefined) return;
        booted = true;
        clearInterval(poll);
        try {
          installHooks();
          window._bK(controller, controller);
          window._tK(controller, controller, "savedata.ini");
          window.global._mu = false;
          var teams = Array.from({ length: window._wi(controller._Ej) }, function (_, index) { return extract(teamFields, window._zi(controller._Ej, index)); });
          onEvent({ type: "catalog", teams: teams, career: careerSave ? exportCareer() : null });
          status.textContent = "Exhibition engine ready";
          window.ExhibitionEngine = { setupExhibition: setupExhibition, setInput: setInput, chooseOffense: chooseOffense, switchDefender: switchDefender, match: match, instances: instances, exportCareer: exportCareer, captureSnapshot: captureSnapshot, receiveSnapshot: receiveSnapshot, applySnapshot: applySnapshot, get defender() { return selectedDefender; } };
          if (localTest) {
            var firstTeam = new URLSearchParams(location.search).get("local") === "career" ? exportCareer() : { team: teams[0], roster: [] };
            setupExhibition([firstTeam, { team: teams[1], roster: [] }], { difficulty: 2, minutes: 1 });
          }
        } catch (error) { reportError(error); }
      }, 100);
      setTimeout(function () { if (!booted) reportError(new Error("Exhibition engine did not initialize")); }, 15000);
    } catch (error) { reportError(error); }
  });
})();
