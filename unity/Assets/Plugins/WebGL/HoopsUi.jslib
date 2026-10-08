// Unity -> page glue for the Hoops WebGL template (Assets/WebGLTemplates/Hoops, TemplateData/ui.js): PageBridge.cs
// asks whether the page draws the menus (HoopsUi_Has) and hands it screens to show (HoopsUi_Show: "ready", "menu",
// "pause", "final" + a JSON payload). Without the template (another page) both are harmless no-ops.
mergeInto(LibraryManager.library, {
  HoopsUi_Has: function () {
    try { return typeof window !== "undefined" && window.H2KUI && typeof window.H2KUI.show === "function" ? 1 : 0; } catch (e) { return 0; }
  },
  HoopsUi_Show: function (screen, json) {
    var s = UTF8ToString(screen), j = UTF8ToString(json);
    // async: the page may call back into Unity (SendMessage) from its handlers; never re-enter the running frame
    setTimeout(function () {
      try { if (window.H2KUI) window.H2KUI.show(s, j); } catch (e) { console.error("HoopsUi_Show", e); }
    }, 0);
  }
});
