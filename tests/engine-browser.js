(function () {
  var output = document.getElementById("checks");
  var before = JSON.stringify(Object.assign({}, localStorage));
  var checks = [];
  var mirrorFrame;
  var hostSnapshot;
  var hostTeams;
  document.getElementById("game").src = "../multiplayer-frame.html?local=" + (new URLSearchParams(location.search).has("career") ? "career" : "1");
  function check(condition, message) {
    if (!condition) throw new Error(message);
    checks.push("PASS " + message);
    output.textContent = checks.join("\n");
  }
  window.addEventListener("message", function (event) {
    if (event.data.type === "error") output.textContent += "\nENGINE ERROR " + event.data.message;
    if (event.source === document.getElementById("game").contentWindow && event.data.type === "catalog") hostTeams = event.data.teams;
    if (mirrorFrame && event.source === mirrorFrame.contentWindow) {
      if (event.data.type === "catalog") mirrorFrame.contentWindow.postMessage({ source: "retro-lobby", type: "start", player: 1, teams: hostTeams.slice(0, 2).map(function (team) { return { team: team, roster: [] }; }), settings: { difficulty: 2, minutes: 1 } }, location.origin);
      if (event.data.type === "started") {
        try {
          var mirrorEngine = mirrorFrame.contentWindow.ExhibitionEngine;
          mirrorEngine.applySnapshot(mirrorFrame.contentWindow.JSON.parse(JSON.stringify(hostSnapshot)));
          check(mirrorEngine.instances(74).length === 11 && mirrorEngine.instances(75).length === 11, "Recreate the host's field on a separate client");
          check(mirrorEngine.match()._Sb1[0] === hostSnapshot.score[0] && mirrorEngine.match()._Sb1[1] === hostSnapshot.score[1], "Mirror authoritative scoring");
          check(mirrorEngine.match()._UD === hostSnapshot.possession, "Mirror authoritative possession");
          var x = mirrorEngine.instances(74)[0].x;
          setTimeout(function () {
            try {
              check(mirrorEngine.instances(74)[0].x === x, "Guest rendering does not run local physics");
              checks.push("Engine and rendering checks passed");
              output.textContent = checks.join("\n");
            } catch (error) { output.textContent += "\nFAIL " + error.stack; }
          }, 1000);
        } catch (error) { output.textContent += "\nFAIL " + error.stack; }
      }
      return;
    }
    if (event.source !== document.getElementById("game").contentWindow || event.data.type !== "started") return;
    var gameWindow = event.source;
    var engine = gameWindow.ExhibitionEngine;
    try {
      var game = engine.match();
      check(Boolean(game), "Create a match in the real engine");
      gameWindow._cg4 = true;
      game._t11 = 1;
      game._6F = -25;
      gameWindow._eb1(game, game, 1);
      check(engine.instances(74).length === 11 && engine.instances(75).length === 11, "Create two complete teams");
      engine.switchDefender();
      var defender = engine.instances(75).find(function (player) { return player.id === engine.defender; });
      check(Boolean(defender), "Select an eligible defender");
      engine.setInput(1 - game._UD, { keys: [68] });
      gameWindow._Z71(defender, defender);
      check(defender._o71 === 0, "Keep defenders behind the line before the snap");
      engine.instances(gameWindow.global._d01)[0]._kp = 2;
      gameWindow._Z71(defender, defender);
      check(defender._o71 === 1 && defender._541 === 0, "Route independent input to the defender");
      var selected = defender.id;
      engine.switchDefender();
      check(engine.defender !== selected, "Switch to another eligible defender");
      var possession = game._UD;
      gameWindow._1c1(game, game);
      check(game._UD === 1 - possession && game._0z === game._UD, "Hand offense to the other player");
      game._Vy = 3;
      gameWindow._Ib1(game, game);
      check(game._kp === 2, "Play the second team's drive instead of simulating it (state=" + game._kp + ", team=" + gameWindow._jj(game, game, 64)._Gp + ", teams=" + game._Fj + ", possession=" + game._UD + ")");
      for (var drive = 0; drive < 6; drive++) {
        game._t11 = 1;
        gameWindow._eb1(game, game, 1);
        gameWindow._1c1(game, game);
      }
      game._t11 = 1;
      gameWindow._eb1(game, game, 1);
      check(engine.instances(74).length === 11 && engine.instances(75).length === 11, "Keep both rosters valid across repeated possession changes");
      game._Wy = 1;
      game._t11 = 1;
      var score = game._Sb1[game._UD];
      gameWindow._hB(game, game, 1);
      check(game._Sb1[game._UD] === score + 6, "Score a touchdown using engine rules");
      gameWindow._eb1(game, game, 1);
      hostSnapshot = engine.captureSnapshot();
      check(new Set(hostSnapshot.entities.map(function (entity) { return entity.id; })).size === hostSnapshot.entities.length, "Capture each native entity once using its concrete object type");
      var trajectory = hostSnapshot.entities.find(function (entity) { return entity.type === 78; });
      check(trajectory && trajectory.fields._9L1.length === 50, "Capture the complete native trajectory");
      check(hostSnapshot.entities.length >= 23 && hostSnapshot.camera.length === 4, "Capture native entities and camera");
      gameWindow._1d1(game, game, 1);
      check(JSON.stringify(Object.assign({}, localStorage)) === before, "Leave browser career saves unchanged");
      mirrorFrame = document.createElement("iframe");
      mirrorFrame.src = "../multiplayer-frame.html";
      mirrorFrame.width = 960;
      mirrorFrame.height = 540;
      document.body.appendChild(mirrorFrame);
    } catch (error) {
      output.textContent = checks.join("\n") + "\nFAIL " + (error.stack || String(error));
    }
  });
})();
