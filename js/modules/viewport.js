/* ============================================================
   modules/viewport.js — 呈现区：canvas 渲染 + 变换
   屏幕坐标 = 图片坐标 * scale + (x | y)
   纯变换/渲染逻辑，交互在 modules/input.js
   ============================================================ */
window.IT = window.IT || {};

IT.viewport = (function () {
  "use strict";

  const cfg = IT.config;
  const util = IT.util;
  const S = () => IT.state;

  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let checker = null;
  let checkerKey = "";
  /** 叠加绘制器：render 之后按序调用，参数 (ctx, view) */
  const overlays = [];

  /* ---------- 初始化 ---------- */

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d", { alpha: true });
    resize();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
    IT.bus.on("doc:load", () => { fit(); });
    IT.bus.on("doc:unload", () => { render(); });
    // 任何来源的视口变化都要重绘（含 overlay）
    IT.bus.on("view:change", () => scheduleRender());
    return { canvas, ctx };
  }

  /** 同步 canvas 物理尺寸与 CSS 尺寸 */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    buildChecker();
    render();
  }

  /** 透明棋盘图案（随 dpr / 配置重建） */
  function buildChecker() {
    const { size, a, b } = cfg.CHECK;
    const key = `${size}|${a}|${b}|${dpr.toFixed(2)}`;
    if (checker && key === checkerKey) return;
    checkerKey = key;

    const t = size * 2;
    const px = Math.max(1, Math.round(t * dpr));
    const off = document.createElement("canvas");
    off.width = off.height = px;
    const c = off.getContext("2d");
    c.fillStyle = a;
    c.fillRect(0, 0, px, px);
    c.fillStyle = b;
    c.fillRect(0, 0, px / 2, px / 2);
    c.fillRect(px / 2, px / 2, px / 2, px / 2);

    checker = ctx.createPattern(off, "repeat");
    if (checker && checker.setTransform && window.DOMMatrix) {
      checker.setTransform(new DOMMatrix().scale(1 / dpr));
    }
  }

  /* ---------- 坐标变换 ---------- */

  function screenToImage(sx, sy) {
    const v = S().view;
    return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
  }

  function imageToScreen(ix, iy) {
    const v = S().view;
    return { x: ix * v.scale + v.x, y: iy * v.scale + v.y };
  }

  /** 呈现区 CSS 尺寸 */
  function box() {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  /** 光标是否落在图片内 */
  function insideDoc(sx, sy) {
    const d = S().doc;
    if (!d.image) return false;
    const p = screenToImage(sx, sy);
    return p.x >= 0 && p.y >= 0 && p.x < d.width && p.y < d.height;
  }

  /* ---------- 渲染 ---------- */

  const scheduleRender = IT.util.raf(() => render());

  function render() {
    const d = S().doc;
    const v = S().view;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    if (!d.image) {
      IT.bus.emit("view:render", {});
      return;
    }

    const bw = d.width * v.scale;
    const bh = d.height * v.scale;

    // 透明区域：棋盘（锚定到图片原点，平移时不闪动）
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.x, v.y, bw, bh);
    ctx.clip();
    if (checker) {
      const cell = cfg.CHECK.size * 2;
      ctx.translate(v.x, v.y);
      ctx.fillStyle = checker;
      ctx.fillRect(-cell, -cell, bw + cell * 2, bh + cell * 2);
    }
    ctx.restore();

    // 图片本体
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = v.scale < 1 ? "high" : "medium";
    ctx.drawImage(d.image, v.x, v.y, bw, bh);

    // 1px 描边：浅色环境下用柔和的分隔线
    ctx.strokeStyle = "rgba(23,32,46,.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(v.x + 0.5, v.y + 0.5, bw - 1, bh - 1);
    ctx.restore();

    // 叠加层（裁剪选区等）：坐标系仍是 CSS 像素
    for (const draw of overlays) {
      try { draw(ctx, { scale: v.scale, x: v.x, y: v.y, box: box() }); }
      catch (err) { console.error("[overlay]", err); }
    }

    IT.bus.emit("view:render", {});
  }

  /* ---------- 视口操作 ---------- */

  /** state.setView 已广播 view:change，这里只需安排重绘 */
  function viewChanged() {
    scheduleRender();
  }

  /**
   * 设置缩放，anchor 为屏幕上的锚点（默认视口中心）。
   */
  function setScale(scale, anchor) {
    const s = cfg.snapScale(cfg.clampScale(scale));
    const v = S().view;
    const b = box();
    const ax = anchor ? anchor.x : b.w / 2;
    const ay = anchor ? anchor.y : b.h / 2;
    const p = screenToImage(ax, ay);
    S().setView(s, ax - p.x * s, ay - p.y * s);
    viewChanged();
  }

  /** 以 (sx,sy) 为锚点，按 factor 缩放 */
  function zoomAt(factor, sx, sy) {
    setScale(S().view.scale * factor, { x: sx, y: sy });
  }

  /** 视口中心等比缩放 */
  function zoomBy(factor) {
    const b = box();
    zoomAt(factor, b.w / 2, b.h / 2);
  }

  /** 当前窗口对应的“适应”缩放值 */
  function fitScale() {
    const d = S().doc;
    const b = box();
    if (!d.image) return 1;
    return cfg.clampScale(Math.min(
      (b.w - cfg.FIT_PADDING * 2) / d.width,
      (b.h - cfg.FIT_PADDING * 2) / d.height,
      cfg.FIT_MAX
    ));
  }

  /** 适应窗口 */
  function fit() {
    const d = S().doc;
    if (!d.image) { render(); return; }
    const b = box();
    const s = fitScale();
    S().setView(s, (b.w - d.width * s) / 2, (b.h - d.height * s) / 2);
    viewChanged();
  }

  /** 实际像素 100%，居中 */
  function zoom100() {
    const d = S().doc;
    const b = box();
    if (!d.image) return;
    S().setView(1, (b.w - d.width) / 2, (b.h - d.height) / 2);
    viewChanged();
  }

  /** 平移（CSS px 增量） */
  function pan(dx, dy) {
    const v = S().view;
    S().setView(v.scale, v.x + dx, v.y + dy);
    viewChanged();
  }

  /** 视口当前是否处于“适应窗口”状态 */
  function isFitted() {
    if (!S().doc.image) return true;
    const s = fitScale();
    return Math.abs(S().view.scale - s) < s * 1e-3;
  }

  return {
    init, resize, render, box, context: () => ctx,
    onOverlay: (fn) => { overlays.push(fn); return fn; },
    screenToImage, imageToScreen, insideDoc,
    setScale, zoomAt, zoomBy, fit, fitScale, zoom100, pan,
    isFitted, scheduleRender,
  };
})();
