// Hoops 2K27 online bridge (WebGL): the page's JavaScript side of unity/Assets/Scripts/Game/Net/UnityNet.cs.
// Three backends, all event-queued (C# drains everything once per frame with HN_Poll, as one JSON array):
//  - the claude.ai `room` capability (window.claude.use("room")) when the build is published as an artifact;
//  - a WebSocket to server/relay.ts (same JSON presence protocol as the browser build: PROTO 10);
//  - WebRTC data channels (unordered, maxRetransmits 0; non-trickle ICE with STUN) for the direct guest <-> host path.
// The reliability logic (pacing, retries, re-assert, rejoin, heartbeats, fallbacks) lives in C#; this file only wraps
// the browser APIs.
var HoopsNetLib = {
  $HN: {
    q: [],
    n: 1,
    ns: undefined, // room namespace (claude.use("room"))
    rooms: {},
    socks: {},
    rtcs: {},
    push: function (o) {
      HN.q.push(o);
      if (HN.q.length > 4000) HN.q.splice(0, HN.q.length - 4000); // (a stalled frame loop never eats all memory)
    },
    str: function (s) {
      var n = lengthBytesUTF8(s) + 1;
      var b = _malloc(n);
      stringToUTF8(s, b, n);
      return b;
    },
    wsUrl: function () {
      try {
        var q = new URLSearchParams(location.search).get("ws");
        if (q) return q;
        if (/^https?:$/.test(location.protocol) && !/claude\.(ai|com)|claudeusercontent/.test(location.host) && window.__H2K_WS !== false)
          return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
      } catch (e) {}
      return "";
    },
    peersOf: function (h, list) {
      var R = HN.rooms[h];
      if (!R) return;
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i],
          js = JSON.stringify(p.presence || {});
        // unchanged presence: send a marker so C# keeps the same state object (the sessions compare identity)
        if (R.cache[p.peer] === js) out.push({ id: p.peer, me: !!p.sameTab, same: 1 });
        else {
          R.cache[p.peer] = js;
          out.push({ id: p.peer, me: !!p.sameTab, st: p.presence || {} });
        }
      }
      HN.push({ e: "room", h: h, k: "peers", d: out });
    },
    bindDc: function (h, dc) {
      var R = HN.rtcs[h];
      if (!R) return;
      R.dc = dc;
      dc.onopen = function () {
        HN.push({ e: "rtc", h: h, k: "open" });
      };
      dc.onmessage = function (m) {
        HN.push({ e: "rtc", h: h, k: "msg", d: String(m.data) });
      };
      dc.onclose = function () {
        HN.push({ e: "rtc", h: h, k: "close" });
      };
    },
    gather: function (h) {
      // non-trickle ICE: publish the complete description once gathering is done (or after 3 s with what we have)
      var R = HN.rtcs[h];
      if (!R) return;
      var pc = R.pc,
        sent = false;
      var done = function () {
        if (sent || !HN.rtcs[h] || !pc.localDescription) return;
        sent = true;
        HN.push({ e: "rtc", h: h, k: "sdp", d: pc.localDescription.sdp });
      };
      if (pc.iceGatheringState === "complete") return done();
      pc.addEventListener("icegatheringstatechange", function () {
        if (pc.iceGatheringState === "complete") done();
      });
      setTimeout(done, 3000);
    },
    fail: function (h) {
      return function (e) {
        HN.push({ e: "rtc", h: h, k: "close", d: String((e && e.message) || e) });
      };
    },
  },

  // ---- environment ----
  HN_Detect__deps: ["$HN"],
  HN_Detect: function () {
    try {
      if (new URLSearchParams(location.search).get("ws")) return HN.push({ e: "detect", kind: "ws" });
      var w = window;
      if (w.claude && typeof w.claude.use === "function") {
        // On the published page: live rooms only (never guess a server on the page's own host).
        if (HN.ns !== undefined) return HN.push({ e: "detect", kind: HN.ns ? "room" : "" });
        w.claude.use("room").then(
          function (r) {
            HN.ns = r || null;
            HN.push({ e: "detect", kind: r ? "room" : "" });
          },
          function () {
            HN.ns = null;
            HN.push({ e: "detect", kind: "" });
          },
        );
        return;
      }
      HN.push({ e: "detect", kind: HN.wsUrl() ? "ws" : "" });
    } catch (e) {
      HN.push({ e: "detect", kind: "" });
    }
  },
  HN_WsUrl__deps: ["$HN"],
  HN_WsUrl: function () {
    return HN.str(HN.wsUrl());
  },
  HN_HasRtc: function () {
    return typeof RTCPeerConnection === "function" ? 1 : 0;
  },
  HN_Poll__deps: ["$HN"],
  HN_Poll: function () {
    if (!HN.q.length) return 0;
    var s = JSON.stringify(HN.q);
    HN.q = [];
    return HN.str(s);
  },

  // ---- claude.ai room ----
  HN_RoomJoin__deps: ["$HN"],
  HN_RoomJoin: function (namePtr) {
    var name = UTF8ToString(namePtr),
      h = HN.n++;
    if (!HN.ns) {
      setTimeout(function () {
        HN.push({ e: "room", h: h, k: "fail", d: "no room capability" });
      }, 0);
      return h;
    }
    HN.ns.join(name).then(
      function (r) {
        HN.rooms[h] = { r: r, cache: {} };
        HN.push({ e: "room", h: h, k: "joined" });
        try {
          r.onPeers(
            function (ch) {
              HN.peersOf(h, ch.peers);
            },
            function (e) {
              console.warn("room", e && e.code);
            },
          );
        } catch (e) {}
        try {
          HN.peersOf(h, r.peers());
        } catch (e) {}
      },
      function (e) {
        HN.push({ e: "room", h: h, k: "fail", d: String((e && (e.code || e.message)) || e) });
      },
    );
    return h;
  },
  HN_RoomPresence__deps: ["$HN"],
  HN_RoomPresence: function (h, jsonPtr, seq) {
    var R = HN.rooms[h];
    if (!R) return HN.push({ e: "room", h: h, k: "pres", seq: seq, ok: 0, d: "not joined" });
    var p;
    try {
      p = Promise.resolve(R.r.presence(JSON.parse(UTF8ToString(jsonPtr))));
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      function () {
        HN.push({ e: "room", h: h, k: "pres", seq: seq, ok: 1 });
      },
      function (e) {
        HN.push({ e: "room", h: h, k: "pres", seq: seq, ok: 0, d: String((e && (e.code || e.message)) || e) });
      },
    );
  },
  HN_RoomConnected__deps: ["$HN"],
  HN_RoomConnected: function (h) {
    var R = HN.rooms[h];
    try {
      return R && R.r.connected() ? 1 : 0;
    } catch (e) {
      return 0;
    }
  },
  HN_RoomLeave__deps: ["$HN"],
  HN_RoomLeave: function (h) {
    var R = HN.rooms[h];
    delete HN.rooms[h];
    try {
      R && R.r.leave().catch(function () {});
    } catch (e) {}
  },

  // ---- WebSocket (relay) ----
  HN_WsOpen__deps: ["$HN"],
  HN_WsOpen: function (urlPtr) {
    var url = UTF8ToString(urlPtr),
      h = HN.n++,
      ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setTimeout(function () {
        HN.push({ e: "ws", h: h, k: "close" });
      }, 0);
      return h;
    }
    HN.socks[h] = ws;
    ws.onopen = function () {
      HN.push({ e: "ws", h: h, k: "open" });
    };
    ws.onmessage = function (m) {
      HN.push({ e: "ws", h: h, k: "msg", d: String(m.data) });
    };
    ws.onerror = function () {
      HN.push({ e: "ws", h: h, k: "err" });
    };
    ws.onclose = function () {
      HN.push({ e: "ws", h: h, k: "close" });
      delete HN.socks[h];
    };
    return h;
  },
  HN_WsSend__deps: ["$HN"],
  HN_WsSend: function (h, sPtr) {
    var ws = HN.socks[h];
    if (ws && ws.readyState === 1)
      try {
        ws.send(UTF8ToString(sPtr));
      } catch (e) {}
  },
  HN_WsClose__deps: ["$HN"],
  HN_WsClose: function (h) {
    var ws = HN.socks[h];
    try {
      ws && ws.close();
    } catch (e) {}
  },
  HN_WsState__deps: ["$HN"],
  HN_WsState: function (h) {
    var ws = HN.socks[h];
    return ws ? ws.readyState : 3;
  },

  // ---- WebRTC data channel ----
  HN_RtcNew__deps: ["$HN"],
  HN_RtcNew: function () {
    var h = HN.n++;
    try {
      var pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      HN.rtcs[h] = { pc: pc, dc: null };
      pc.onconnectionstatechange = function () {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") HN.push({ e: "rtc", h: h, k: "close", d: pc.connectionState });
      };
      pc.ondatachannel = function (ev) {
        HN.bindDc(h, ev.channel);
      };
    } catch (e) {
      setTimeout(function () {
        HN.push({ e: "rtc", h: h, k: "close", d: "no WebRTC" });
      }, 0);
    }
    return h;
  },
  HN_RtcOffer__deps: ["$HN"],
  HN_RtcOffer: function (h) {
    var R = HN.rtcs[h];
    if (!R) return;
    HN.bindDc(h, R.pc.createDataChannel("h2k", { ordered: false, maxRetransmits: 0 }));
    R.pc
      .createOffer()
      .then(function (o) {
        return R.pc.setLocalDescription(o);
      })
      .then(function () {
        HN.gather(h);
      }, HN.fail(h));
  },
  HN_RtcAnswer__deps: ["$HN"],
  HN_RtcAnswer: function (h, sdpPtr) {
    var R = HN.rtcs[h];
    if (!R) return;
    R.pc
      .setRemoteDescription({ type: "offer", sdp: UTF8ToString(sdpPtr) })
      .then(function () {
        return R.pc.createAnswer();
      })
      .then(function (a) {
        return R.pc.setLocalDescription(a);
      })
      .then(function () {
        HN.gather(h);
      }, HN.fail(h));
  },
  HN_RtcAccept__deps: ["$HN"],
  HN_RtcAccept: function (h, sdpPtr) {
    var R = HN.rtcs[h];
    if (!R) return;
    R.pc.setRemoteDescription({ type: "answer", sdp: UTF8ToString(sdpPtr) }).catch(HN.fail(h));
  },
  HN_RtcSend__deps: ["$HN"],
  HN_RtcSend: function (h, sPtr) {
    var R = HN.rtcs[h];
    // (an unreliable channel: when the buffer backs up, newer state is coming anyway - drop instead of queueing)
    if (R && R.dc && R.dc.readyState === "open" && R.dc.bufferedAmount < 65536)
      try {
        R.dc.send(UTF8ToString(sPtr));
      } catch (e) {}
  },
  HN_RtcClose__deps: ["$HN"],
  HN_RtcClose: function (h) {
    var R = HN.rtcs[h];
    delete HN.rtcs[h];
    try {
      R && R.dc && R.dc.close();
    } catch (e) {}
    try {
      R && R.pc.close();
    } catch (e) {}
  },
};
mergeInto(LibraryManager.library, HoopsNetLib);
