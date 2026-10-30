(function () {
  var output = document.getElementById("checks");
  var before = JSON.stringify(Object.assign({}, localStorage));
  var checks = [];
  function check(condition, message) {
    if (!condition) throw new Error(message);
    checks.push("PASS " + message);
    output.textContent = checks.join("\n");
  }
  window.addEventListener("message", function (event) {
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
      game._Wy = 1;
      game._t11 = 1;
      var score = game._Sb1[game._UD];
      gameWindow._hB(game, game, 1);
      check(game._Sb1[game._UD] === score + 6, "Score a touchdown using engine rules");
      gameWindow._1d1(game, game, 1);
      check(JSON.stringify(Object.assign({}, localStorage)) === before, "Leave browser career saves unchanged");
      checks.push("Engine milestone passed");
      output.textContent = checks.join("\n");
    } catch (error) {
      output.textContent = checks.join("\n") + "\nFAIL " + error.stack;
    }
  });
})();
