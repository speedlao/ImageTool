/* ============================================================
   main.js — 启动
   ============================================================ */
(function () {
  "use strict";

  const S = IT.state;
  const cfg = IT.config;

  let hint = null;
  let canvas = null;

  document.addEventListener("DOMContentLoaded", boot);

  function boot() {
    canvas = document.getElementById("viewport");
    hint = document.getElementById("empty-hint");

    // 模块初始化顺序：状态栏控件 → 视口 → 裁剪层 → 浮窗 → 工具栏 → 交互
    IT.statusbar.init();
    IT.viewport.init(canvas);
    IT.crop.init(canvas);
    IT.panels.init();
    IT.toolbar.init();
    IT.input.init(canvas);

    // 提示条
    IT.bus.on("notify", (d) => {
      if (d.kind === "warn") IT.toast.warn(d.message);
      else IT.toast.show(d.message);
    });

    // 空态提示
    IT.bus.on("doc:load", () => {
      setEmpty(false);
      IT.statusbar.syncSize();
    });
    IT.bus.on("doc:unload", () => setEmpty(true));
    IT.bus.on("view:change", syncHintState);

    setEmpty(!S.doc.image);
    IT.statusbar.syncAll();

    console.info(
      "%c ImageTool %c M2 · 裁剪 / 旋转已就绪 · 缩放 " +
      Math.round(cfg.MIN_SCALE * 100) + "%–" + Math.round(cfg.MAX_SCALE * 100) + "%" +
      " · C 进入裁剪",
      "background:#3e63dd;color:#fff;border-radius:3px;padding:2px 6px",
      "color:#8e99ab"
    );
  }

  function setEmpty(empty) {
    if (hint) hint.classList.toggle("hidden", !empty);
    canvas.classList.toggle("empty", empty);
  }

  function syncHintState() {
    if (S.doc.image && !hint.classList.contains("hidden")) setEmpty(false);
  }

  // 暴露到全局，方便控制台调试
  window.IT.debug = { state: S, viewport: IT.viewport, fileio: IT.fileio };
})();
