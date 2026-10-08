// Browser glue for Broadcast.cs (WebGL builds only): commentary voice via speechSynthesis and gamepad rumble via the
// Gamepad API's vibrationActuator - the same calls as src/client/broadcast.ts. Everything is wrapped in try/catch:
// sandboxed iframes can block both (permissions policy), and that must never take the game down.
mergeInto(LibraryManager.library, {
  HoopsSpeak: function (txt, rate, pitch, vol, now) {
    try {
      if (typeof speechSynthesis === "undefined") return 0;
      var S = window.__h2kSpeech || (window.__h2kSpeech = { q: 0, v: null, init: 0 });
      if (!S.init) {
        S.init = 1;
        var pick = function () {
          try {
            var vs = speechSynthesis.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
            S.v = vs.find(function (v) { return /daniel|alex|google us english|david|guy|male/i.test(v.name); }) || vs[0] || null;
          } catch (e) {}
        };
        pick();
        try { speechSynthesis.onvoiceschanged = pick; } catch (e) {}
      }
      if (now) { speechSynthesis.cancel(); S.q = 0; }
      else if (S.q >= 2) return 0; // never fall behind the game
      var u = new SpeechSynthesisUtterance(UTF8ToString(txt));
      if (S.v) u.voice = S.v;
      u.rate = rate; u.pitch = pitch; u.volume = vol;
      S.q++;
      u.onend = u.onerror = function () { S.q = Math.max(0, S.q - 1); };
      speechSynthesis.speak(u);
      return 1;
    } catch (e) { return 0; }
  },
  HoopsSpeechCancel: function () {
    try { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); if (window.__h2kSpeech) window.__h2kSpeech.q = 0; } catch (e) {}
  },
  HoopsRumble: function (v, ms) {
    try {
      var gs = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var i = 0; i < gs.length; i++) {
        var a = gs[i] && gs[i].vibrationActuator;
        if (a && a.playEffect) a.playEffect("dual-rumble", { duration: ms, strongMagnitude: Math.min(1, v), weakMagnitude: Math.min(1, v * 0.7) });
      }
    } catch (e) {}
  }
});
