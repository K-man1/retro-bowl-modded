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
  var inputs = [{ keys: [] }, { keys: [] }];
  var actionQueues = [[], []];
  var lastInputAt = [0, 0];
  var localPlayer = 0;
  var onEvent = function (event) { parent.postMessage(Object.assign({ source: "retro-exhibition" }, event), location.origin); };
  var status = document.getElementById("engine-status");
  var prompt = null;
  var promptCallbacks = [];
  var promptSerial = 0;

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
    inputs = [{ keys: [] }, { keys: [] }];
    actionQueues = [[], []];
  }

  function setupExhibition(teams, options) {
    selections = teams;
    rosterLists = teams.map(function (selection) {
      var list = window._4j();
      selection.roster.forEach(function (player) {
        var fields = Object.assign({ condition: 100, resting: 0, backup: 0, morale: 100 }, player);
        // Career stat routines expect these counters even for a roster imported from another device.
        var template = mapFields(window._zi(controller._Ln, 0));
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
    window._Yi(controller._Gn, "op_weather", 0);
    window._Yi(controller._Gn, "op_zoom", 0);
    window._gx(controller, controller);
    running = true;
    finished = false;
    paused = false;
    prompt = null;
    window._Hj(17);
    var timer = setInterval(function () {
      var game = match();
      if (!game) return;
      clearInterval(timer);
      controller._Fj = teamMaps.slice();
      game._Fj = teamMaps.slice();
      game._bL = teams.map(function (selection) { return selection.team.name; });
      game.__41 = teams.map(function (selection) { return selection.team.offense; });
      game._151 = teams.map(function (selection) { return selection.team.defense; });
      window._gx(controller, controller);
      chooseOffense(game._UD);
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
    if (input.actions) actionQueues[side].push.apply(actionQueues[side], input.actions);
  }
  function defend(player) {
    if (!running || finished || paused) return false;
    var game = match();
    if (!selectedDefender || !eligibleDefenders().some(function (candidate) { return candidate.id === selectedDefender; })) switchDefender();
    if (player.id !== selectedDefender) return false;
    var side = 1 - game._UD;
    var keys = performance.now() - lastInputAt[side] < 500 ? inputs[side].keys : [];
    var x = Number(keys.includes(68) || keys.includes(39)) - Number(keys.includes(65) || keys.includes(37));
    var y = Number(keys.includes(83) || keys.includes(40)) - Number(keys.includes(87) || keys.includes(38));
    player._o71 = x || y ? 1 : 0;
    if (x || y) player._541 = window._701(0, 0, x, y);
    return true;
  }

  function installHooks() {
    window._Y._OU1.forEach(function (name, index) {
      if (name.indexOf("gml_Script_") === 0) scripts[name.slice(11)] = window._Y._PU1[index].name;
    });
    hook("s_savegame", function () {});
    hook("s_end_match", function () {
      finished = true;
      onEvent({ type: "finished", score: match()._Sb1.slice() });
    });
    hook("s_change_possession", function () {
      var before = match()._UD;
      var result = original("s_change_possession", arguments);
      if (running && match()._UD !== before) chooseOffense(match()._UD);
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
    hook("s_aim_AI_defense", function (player) {
      if (!defend(player)) return original("s_aim_AI_defense", arguments);
    });
    var aim = window._Z71;
    window._Z71 = function (player) {
      if (!player._lT && defend(player)) return;
      return aim.apply(window, arguments);
    };
    var update = window._8j5;
    window._8j5 = function () {
      if (running && (paused || finished)) {
        if (window._Sc2) window._Sc2._Ch2();
        return;
      }
      if (running && match()) {
        var side = 1 - match()._UD;
        var actions = actionQueues[side].splice(0);
        actions.forEach(function (action) {
          if (action === "switch") switchDefender();
          if (action === "dive") {
            var defender = eligibleDefenders().find(function (candidate) { return candidate.id === selectedDefender; });
            if (defender) window._Z01(defender, defender, 5);
          }
        });
      }
      return update.apply(window, arguments);
    };
  }

  function reportError(error) {
    status.textContent = error.message;
    onEvent({ type: "error", message: error.message });
    console.error(error);
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== location.origin || event.source !== parent || !event.data || event.data.source !== "retro-lobby") return;
    var message = event.data;
    if (message.type === "start") {
      localPlayer = message.player;
      setupExhibition(message.teams, message.settings);
    }
    if (message.type === "input") setInput(message.player, message.input);
    if (message.type === "pause") paused = message.paused;
  });

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
          window.ExhibitionEngine = { setupExhibition: setupExhibition, setInput: setInput, chooseOffense: chooseOffense, switchDefender: switchDefender, match: match, instances: instances, exportCareer: exportCareer, get defender() { return selectedDefender; } };
          if (localTest) {
            setupExhibition([{ team: teams[0], roster: [] }, { team: teams[1], roster: [] }], { difficulty: 2, minutes: 1 });
          }
        } catch (error) { reportError(error); }
      }, 100);
      setTimeout(function () { if (!booted) reportError(new Error("Exhibition engine did not initialize")); }, 15000);
    } catch (error) { reportError(error); }
  });
})();
