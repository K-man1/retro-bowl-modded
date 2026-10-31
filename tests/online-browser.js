(async function () {
  "use strict";
  var output = document.getElementById("checks");
  var checks = [];
  var saves = JSON.stringify(Object.assign({}, localStorage));
  sessionStorage.removeItem("retro-online-room");
  function check(condition, text) {
    if (!condition) throw new Error(text);
    checks.push("PASS " + text);
    output.textContent = checks.join("\n");
  }
  async function until(predicate, text) {
    var end = Date.now() + 20000;
    while (Date.now() < end) {
      if (predicate()) return;
      await new Promise(function (resolve) { setTimeout(resolve, 50); });
    }
    throw new Error("Timed out: " + text);
  }
  function button(frame, name) { return frame.document.getElementById("online-" + name); }
  function engineWindow(frame) { return frame.document.getElementById("online-frame").contentWindow; }
  try {
    var host = document.getElementById("host").contentWindow;
    var guest = document.getElementById("guest").contentWindow;
    await until(function () { return button(host, "open") && button(guest, "open"); }, "load both clients");
    var latency = Number(new URLSearchParams(location.search).get("latency")) || 0;
    if (latency) [host, guest].forEach(function (client) {
      var nativeSend = client.WebSocket.prototype.send;
      var nativeListen = client.WebSocket.prototype.addEventListener;
      client.WebSocket.prototype.send = function (message) { var socket = this; setTimeout(function () { nativeSend.call(socket, message); }, latency / 2); };
      client.WebSocket.prototype.addEventListener = function (type, listener, options) {
        return nativeListen.call(this, type, type === "message" ? function (event) { setTimeout(function () { listener(event); }, latency / 2); } : listener, options);
      };
    });
    button(host, "open").click();
    button(guest, "open").click();
    await until(function () { return !button(host, "create").disabled && !button(guest, "join").disabled; }, "initialize both engines");
    check(true, "Initialize two independent browser clients");
    button(host, "create").click();
    await until(function () { return button(host, "room-code").textContent.length === 6; }, "create room");
    var code = button(host, "room-code").textContent;
    button(guest, "code").value = code;
    button(guest, "join").click();
    await until(function () { return button(guest, "room-code").textContent === code && !button(guest, "ready").disabled; }, "join room");
    check(button(host, "players").textContent.includes("PLAYER 2: Buffalo"), "Join a room through the real WebSocket server");
    button(guest, "team").value = "1";
    button(guest, "team").dispatchEvent(new guest.Event("change"));
    await until(function () { return button(host, "players").textContent.includes("Miami"); }, "sync team selection");
    button(host, "minutes").value = "1";
    button(host, "minutes").dispatchEvent(new host.Event("change"));
    await until(function () { return button(guest, "minutes").value === "1"; }, "sync match settings");
    check(true, "Synchronize team selection and quarter length");
    button(host, "ready").click();
    await until(function () { return button(host, "ready").textContent === "NOT READY"; }, "ready host");
    button(guest, "ready").click();
    await until(function () { return button(host, "role").textContent && button(guest, "role").textContent; }, "start synchronized match");
    check(true, "Start the same exhibition on both clients");
    var hostGame = engineWindow(host);
    var guestGame = engineWindow(guest);
    var match = hostGame.ExhibitionEngine.match();
    check(guestGame.ExhibitionEngine.match()._UD === match._UD, "Synchronize initial possession");
    var offense = match._UD === 0 ? host : guest;
    button(offense, "continue").click();
    await until(function () { return hostGame.ExhibitionEngine.instances(74).length === 11; }, "advance to a playable drive");
    await until(function () { return guestGame.ExhibitionEngine.instances(74).length === 11; }, "mirror active drive");
    check(true, "Render a live drive with both complete teams on the guest");
    offense = match._UD === 0 ? host : guest;
    var offenseGame = engineWindow(offense);
    var canvas = offenseGame.document.getElementById("canvas");
    var bounds = canvas.getBoundingClientRect();
    // Synthetic pointer events do not allocate a browser hardware pointer to capture.
    canvas.setPointerCapture = function () {};
    function point(type, x, y) {
      canvas.dispatchEvent(new offenseGame.PointerEvent(type, { clientX: bounds.left + bounds.width * x, clientY: bounds.top + bounds.height * y, pointerId: 1, bubbles: true }));
    }
    var ball = hostGame.ExhibitionEngine.instances(hostGame.global._d01)[0];
    point("pointerdown", 0.6, 0.5);
    await until(function () { return ball._kp === 1; }, "begin aiming from the offensive client");
    point("pointermove", match._501 === 1 ? 0.3 : 0.9, 0.45);
    await until(function () { return ball._kp === 2; }, "drag to aim");
    await until(function () {
      var trajectory = guestGame.ExhibitionEngine.instances(78)[0];
      output.textContent = checks.join("\n") + "\nAiming: " + JSON.stringify({ host: ball._kp, guest: trajectory && [trajectory._iL1, trajectory._9L1.length, trajectory._aL1.length, trajectory._bL1.length] });
      return trajectory && trajectory._iL1 > 0 && trajectory._9L1.length === 50 && trajectory._aL1.length === 50 && trajectory._bL1.length === 50;
    }, "mirror native aiming dots");
    check(true, "Preserve all native trajectory points on player two's screen");
    var defenseGame = match._UD === 0 ? guestGame : hostGame;
    var defender = hostGame.ExhibitionEngine.instances(75).find(function (entry) { return entry.id === hostGame.ExhibitionEngine.defender; });
    await until(function () { return Boolean(hostGame.ExhibitionEngine.defender); }, "select defender");
    defender = hostGame.ExhibitionEngine.instances(75).find(function (entry) { return entry.id === hostGame.ExhibitionEngine.defender; });
    var initialX = defender.x;
    defenseGame.dispatchEvent(new defenseGame.KeyboardEvent("keydown", { key: "d", keyCode: 68, bubbles: true }));
    await until(function () { return defender.x > initialX + 2; }, "move defender using the defensive client's keyboard");
    defenseGame.dispatchEvent(new defenseGame.KeyboardEvent("keyup", { key: "d", keyCode: 68, bubbles: true }));
    check(true, "Send defensive keyboard input to the host simulation");
    var oldDefender = hostGame.ExhibitionEngine.defender;
    defenseGame.dispatchEvent(new defenseGame.KeyboardEvent("keydown", { key: "q", keyCode: 81, bubbles: true }));
    defenseGame.dispatchEvent(new defenseGame.KeyboardEvent("keyup", { key: "q", keyCode: 81, bubbles: true }));
    await until(function () { return hostGame.ExhibitionEngine.defender !== oldDefender; }, "switch defenders");
    check(true, "Switch defenders from the defensive client's keyboard");
    defender = hostGame.ExhibitionEngine.instances(75).find(function (entry) { return entry.id === hostGame.ExhibitionEngine.defender; });
    var initialY = defender.y;
    defenseGame.dispatchEvent(new defenseGame.KeyboardEvent("keydown", { key: "s", keyCode: 83, bubbles: true }));
    await until(function () { return defender.y > initialY + 2; }, "move the selected defender down");
    defenseGame.dispatchEvent(new defenseGame.KeyboardEvent("keyup", { key: "s", keyCode: 83, bubbles: true }));
    initialY = defender.y;
    defenseGame.dispatchEvent(new defenseGame.KeyboardEvent("keydown", { key: "w", keyCode: 87, bubbles: true }));
    await until(function () { return defender.y < initialY - 2; }, "reverse the selected defender upward");
    defenseGame.dispatchEvent(new defenseGame.KeyboardEvent("keyup", { key: "w", keyCode: 87, bubbles: true }));
    check(true, "Move the selected defender down and back up through the network");
    point("pointerup", match._501 === 1 ? 0.3 : 0.9, 0.45);
    await until(function () { return ball._kp === 3; }, "release a pass");
    check(true, "Aim and throw using the offensive client's pointer input");
    check(JSON.stringify(Object.assign({}, localStorage)) === saves, "Preserve career saves during a network match");
    checks.push("Two-client checks passed" + (latency ? " at " + latency + " ms simulated RTT" : ""));
    output.textContent = checks.join("\n");
  } catch (error) {
    output.textContent = checks.join("\n") + "\nFAIL " + (error.stack || error);
  }
})();
