(function (root) {
  "use strict";
  var keys = [87, 65, 83, 68, 37, 38, 39, 40, 32];
  var teamFields = ["uid", "name", "tla", "offense", "defense", "colhelmet", "colshirt", "colpants", "coltertiary", "roof", "rainfall", "snowfall", "helmet"];
  var playerFields = ["uid", "fname", "lname", "position", "skill", "strength", "speed", "stamina", "max_skill", "max_strength", "max_speed", "max_stamina", "condition", "resting", "backup", "face", "face_x", "face_y", "skin", "hair", "age", "morale"];

  function settings(candidate) {
    if (!candidate || !Number.isInteger(candidate.difficulty) || candidate.difficulty < 0 || candidate.difficulty > 4 || ![1, 2, 3].includes(candidate.minutes)) throw new Error("Choose a valid difficulty and quarter length.");
    return { difficulty: candidate.difficulty, minutes: candidate.minutes };
  }
  function pick(source, fields) {
    var selected = {};
    fields.forEach(function (key) {
      var value = source[key];
      if (value === undefined) return;
      if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e9) selected[key] = value;
      else if (typeof value === "string" && value.length <= 64 && !/[\u0000-\u001f]/.test(value)) selected[key] = value;
      else if (typeof value === "boolean") selected[key] = value;
      else throw new Error("Invalid team or player field: " + key);
    });
    return selected;
  }
  function selection(candidate, catalog) {
    if (!candidate) throw new Error("Choose a team first.");
    if (candidate.kind === "regular") {
      var team = catalog.find(function (entry) { return entry.uid === candidate.teamId; });
      if (!team) throw new Error("Unknown team.");
      return { kind: "regular", team: Object.assign({}, team), roster: [] };
    }
    if (candidate.kind !== "career" || !candidate.team || !Array.isArray(candidate.roster) || candidate.roster.length > 32) throw new Error("Invalid career team.");
    var career = pick(candidate.team, teamFields);
    if (!Number.isInteger(career.uid) || !catalog.some(function (entry) { return entry.uid === career.uid; }) || typeof career.name !== "string" || !career.name.length || typeof career.tla !== "string" || !career.tla.length) throw new Error("Invalid career team identity.");
    ["offense", "defense"].forEach(function (rating) {
      if (!Number.isFinite(career[rating]) || career[rating] < 0 || career[rating] > 10) throw new Error("Invalid team rating.");
    });
    ["colhelmet", "colshirt", "colpants", "coltertiary"].forEach(function (color) {
      if (typeof career[color] !== "string" || !/^\$[a-f\d]{6}$/i.test(career[color])) throw new Error("Invalid team color.");
    });
    return { kind: "career", team: career, roster: candidate.roster.map(function (entry) {
      if (!entry || typeof entry !== "object") throw new Error("Invalid player.");
      var player = pick(entry, playerFields);
      if (!Number.isInteger(player.position) || player.position < 1 || player.position > 10) throw new Error("Invalid player position.");
      ["skill", "strength", "speed", "stamina"].forEach(function (rating) {
        if (!Number.isFinite(player[rating]) || player[rating] < 0 || player[rating] > 10) throw new Error("Invalid player rating.");
      });
      return player;
    }) };
  }
  function input(candidate) {
    if (!candidate || !Number.isSafeInteger(candidate.seq) || candidate.seq < 0 || !Array.isArray(candidate.keys) || candidate.keys.length > keys.length || candidate.keys.some(function (key) { return !keys.includes(key); })) throw new Error("Invalid player input.");
    var pointer = candidate.pointer;
    if (!pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y) || pointer.x < 0 || pointer.x > 1 || pointer.y < 0 || pointer.y > 1 || typeof pointer.down !== "boolean") throw new Error("Invalid pointer input.");
    var actions = candidate.actions || [];
    if (!Array.isArray(actions) || actions.length > 12) throw new Error("Too many actions.");
    actions.forEach(function (action) {
      if (!action || !Number.isSafeInteger(action.id) || action.id < 0 || !["switch", "space", "choice", "audible", "timeout", "pointer", "key"].includes(action.type)) throw new Error("Invalid player action.");
      if (action.type === "key" && (!keys.includes(action.code) || action.code === 32)) throw new Error("Invalid key action.");
      if (action.type === "choice" && (!Number.isSafeInteger(action.prompt) || ![0, 1].includes(action.choice))) throw new Error("Invalid choice.");
      if (action.type === "pointer" && (typeof action.down !== "boolean" || !Number.isFinite(action.x) || !Number.isFinite(action.y) || action.x < 0 || action.x > 1 || action.y < 0 || action.y > 1)) throw new Error("Invalid pointer action.");
    });
    return { seq: candidate.seq, keys: Array.from(new Set(candidate.keys)), pointer: { x: pointer.x, y: pointer.y, down: pointer.down }, actions: actions };
  }
  function snapshotDelta(snapshot, previous) {
    if (!previous) return snapshot;
    var before = new Map(previous.entities.map(function (entity) { return [entity.id, entity]; }));
    var entities = [];
    snapshot.entities.forEach(function (entity) {
      var old = before.get(entity.id);
      before.delete(entity.id);
      if (!old || old.type !== entity.type) { entities.push(entity); return; }
      var fields = {};
      Object.keys(entity.fields).forEach(function (key) {
        var field = entity.fields[key];
        if (Array.isArray(field) ? JSON.stringify(field) !== JSON.stringify(old.fields[key]) : field !== old.fields[key]) fields[key] = field;
      });
      var removedFields = Object.keys(old.fields).filter(function (key) { return !Object.prototype.hasOwnProperty.call(entity.fields, key); });
      var playerChanged = JSON.stringify(entity.player) !== JSON.stringify(old.player);
      if (Object.keys(fields).length || removedFields.length || playerChanged) {
        var changed = { id: entity.id, type: entity.type, fields: fields };
        if (removedFields.length) changed.removedFields = removedFields;
        if (playerChanged) changed.player = entity.player || null;
        entities.push(changed);
      }
    });
    return Object.assign({}, snapshot, { base: previous.tick, entities: entities, removed: Array.from(before.keys()) });
  }
  function restoreSnapshot(snapshot, previous) {
    if (snapshot.base === undefined) return snapshot;
    if (!previous || snapshot.base !== previous.tick) throw new Error("Missing match update. Reconnect to the room.");
    var entities = new Map(previous.entities.map(function (entity) { return [entity.id, entity]; }));
    snapshot.removed.forEach(function (id) { entities.delete(id); });
    snapshot.entities.forEach(function (entity) {
      var old = entities.get(entity.id);
      var restored = old && old.type === entity.type ? Object.assign({}, old, entity, { fields: Object.assign({}, old.fields, entity.fields) }) : entity;
      if (entity.removedFields) {
        entity.removedFields.forEach(function (key) { delete restored.fields[key]; });
        delete restored.removedFields;
      }
      if (restored.player === null) delete restored.player;
      entities.set(entity.id, restored);
    });
    var restored = Object.assign({}, snapshot, { entities: Array.from(entities.values()) });
    delete restored.base;
    delete restored.removed;
    return restored;
  }
  var protocol = { version: 1, settings: settings, selection: selection, input: input, snapshotDelta: snapshotDelta, restoreSnapshot: restoreSnapshot, keys: keys, teamFields: teamFields, playerFields: playerFields };
  if (typeof module !== "undefined" && module.exports) module.exports = protocol;
  else root.ExhibitionProtocol = protocol;
})(typeof window === "undefined" ? globalThis : window);
