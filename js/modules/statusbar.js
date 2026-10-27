/* ============================================================
   modules/statusbar.js — 底部状态栏
     B1 图片尺寸   B2 光标坐标   B3 缩放 slider
   ============================================================ */
window.IT = window.IT || {};

IT.statusbar = (function () {
  "use strict";

  const cfg = IT.config;
  const util = IT.util;

  let el = {};
  let syncing = false;   // 防止 slider <-> scale 回环

  function init() {
    el.size   = document.getElementById("lbl-size");
    el.coord  = document.getElementById("lbl-coord");
    el.slider = document.getElementById("zoom-slider");
    el.value  = document.getElementById("zoom-value");
    el.inBtn  = document.getElementById("zoom-in");
    el.outBtn = document.getElementById("zoom-out");
    el.fitBtn = document.getElementById("btn-fit");
    el.pxBtn  = document.getElementById("btn-100");
    el.cell   = document.getElementById("cell-zoom");

    el.slider.max = cfg.SLIDER_MAX;

    // B3：拖动/点击 slider
    el.slider.addEventListener("input", () => {
      if (syncing) return;
      const scale = cfg.sliderToScale(+el.slider.value);
      const b = IT.viewport.box();
      IT.viewport.setScale(scale, { x: b.w / 2, y: b.h / 2 });
    });

    // B3：直接输入百分比
    el.value.addEventListener("change", () => {
      const pct = parseFloat(el.value.value);
      if (!Number.isFinite(pct)) { syncScale(); return; }
      IT.viewport.setScale(util.clamp(pct / 100, cfg.MIN_SCALE, cfg.MAX_SCALE));
    });
    el.value.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.value.blur();
      e.stopPropagation();   // 不触发全局快捷键
    });

    el.inBtn.addEventListener("click", () => IT.viewport.zoomBy(cfg.ZOOM_STEP));
    el.outBtn.addEventListener("click", () => IT.viewport.zoomBy(1 / cfg.ZOOM_STEP));
    el.fitBtn.addEventListener("click", () => IT.viewport.fit());
    el.pxBtn.addEventListener("click", () => IT.viewport.zoom100());

    // 事件订阅
    IT.bus.on("doc:load", syncAll);
    IT.bus.on("doc:unload", syncAll);
    IT.bus.on("view:change", syncScale);
    IT.bus.on("view:change", syncSize);
    IT.bus.on("cursor:move", syncCursor);

    syncAll();
  }

  function setEnabled(on) {
    [el.slider, el.value, el.inBtn, el.outBtn, el.fitBtn, el.pxBtn]
      .forEach((n) => { if (n) n.disabled = !on; });
  }

  /* ---------- B1 尺寸 ---------- */

  function syncSize() {
    const d = IT.state.doc;
    if (!d.image) { el.size.textContent = "— × — px"; return; }
    const v = IT.state.view;
    const parts = [`${util.int(d.width)} × ${util.int(d.height)} px`];
    if (v.scale < 1) parts.push(`显示 ${util.percent(v.scale)}%`);
    el.size.textContent = parts.join("   ");
    el.size.parentElement.title =
      `${d.name || "未命名"}\n` +
      `尺寸 ${util.int(d.width)} × ${util.int(d.height)} px` +
      (d.type ? `\n类型 ${d.type}` : "") +
      (d.bytes ? `\n体积 ${util.bytes(d.bytes)}` : "") +
      `\n屏幕 ${Math.max(1, Math.round(d.width * v.scale))} × ` +
      `${Math.max(1, Math.round(d.height * v.scale))} px`;
  }

  /* ---------- B2 坐标 ---------- */

  function syncCursor(p) {
    const d = IT.state.doc;
    if (!d.image || !p || !p.inside) {
      el.coord.textContent = "x: —\u00a0\u00a0y: —";
      return;
    }
    // 左上角为原点，1-based 像素索引
    const x = Math.min(d.width,  Math.floor(p.x) + 1);
    const y = Math.min(d.height, Math.floor(p.y) + 1);
    el.coord.textContent = `x: ${x}\u00a0\u00a0y: ${y}`;
    el.coord.parentElement.title =
      `原点在图片左上角 · 亚像素 ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`;
  }

  /* ---------- B3 缩放控件同步 ---------- */

  function syncScale() {
    const scale = IT.state.view.scale;
    syncing = true;
    const sv = cfg.scaleToSlider(scale);
    el.slider.value = sv;
    el.slider.style.setProperty("--fill", (sv / cfg.SLIDER_MAX * 100).toFixed(2) + "%");
    const pct = parseFloat(util.percent(scale));
    el.value.value = pct;
    syncing = false;
  }

  function syncAll() {
    const has = !!IT.state.doc.image;
    setEnabled(has);
    syncSize();
    syncScale();
    syncCursor(IT.state.cursor);
  }

  return { init, syncAll, syncSize };
})();
