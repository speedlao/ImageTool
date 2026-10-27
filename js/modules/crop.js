/* ============================================================
   modules/crop.js — M2 裁剪：选区 + 预备裁剪模式
   选区以“图片像素”存储（整数），因此平移/缩放后依然精确。

   交互
     工具栏「裁剪」或 C        进入 / 退出预备裁剪模式
     空白处拖动                重新框选
     选区内拖动                移动
     8 个手柄拖动              调整该边（对侧固定）
     方向键 / Shift+方向键     1px / 10px 微调
     Enter 应用   Esc 取消
   对外
     IT.crop.setMargin(side, px)  left|right|top|bottom
     IT.crop.setSize(w, h)
     IT.crop.getRect() → {x,y,w,h}
   事件：crop:enter / crop:exit / crop:rect
   ============================================================ */
window.IT = window.IT || {};

IT.crop = (function () {
  "use strict";

  const MIN = 1;              // 选区最小边长(px)
  const TOL = 8;              // 手柄命中半径(屏幕 px)
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const CURSORS = {
    nw: "nwse-resize", se: "nwse-resize",
    ne: "nesw-resize", sw: "nesw-resize",
    n: "ns-resize", s: "ns-resize",
    e: "ew-resize", w: "ew-resize",
    move: "move",
  };

  const VP = () => IT.viewport;
  const S = () => IT.state;

  let canvas = null;
  let active = false;
  let rect = null;            // {x,y,w,h} 图片整数坐标
  let drag = null;

  /* ---------- 工具 ---------- */

  const doc = () => S().doc;

  function clampRect(r) {
    const d = doc();
    const w = IT.util.clamp(Math.round(r.w), MIN, Math.max(MIN, d.width));
    const h = IT.util.clamp(Math.round(r.h), MIN, Math.max(MIN, d.height));
    return {
      x: IT.util.clamp(Math.round(r.x), 0, d.width - w),
      y: IT.util.clamp(Math.round(r.y), 0, d.height - h),
      w, h,
    };
  }

  /** 归一化 + 夹取，并广播 */
  function setRect(r, silent = false) {
    const next = clampRect(r);
    const changed = !rect || next.x !== rect.x || next.y !== rect.y
      || next.w !== rect.w || next.h !== rect.h;
    rect = next;
    if (changed && !silent) emitRect();
    VP().scheduleRender();
    return rect;
  }

  function emitRect() {
    const d = doc();
    IT.bus.emit("crop:rect", {
      x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      left: rect.x, top: rect.y,
      right: d.width - (rect.x + rect.w),
      bottom: d.height - (rect.y + rect.h),
    });
  }

  /* ---------- 模式开关 ---------- */

  function isActive() { return active; }

  function enter() {
    if (active) return false;
    if (!doc().image) { IT.toast.show("先打开一张图片", "warn"); return false; }
    active = true;
    if (!rect) rect = { x: 0, y: 0, w: doc().width, h: doc().height };
    IT.bus.emit("crop:enter", { ...rect });
    emitRect();
    VP().scheduleRender();
    return true;
  }

  function exit(silent = false) {
    if (!active) return false;
    active = false;
    rect = null;
    drag = null;
    if (canvas) canvas.style.cursor = "";
    if (!silent) IT.bus.emit("notify", { message: "已取消裁剪" });
    IT.bus.emit("crop:exit", {});
    VP().scheduleRender();
    return true;
  }

  function toggle() { return active ? exit() : enter(); }

  /* ---------- 面板写入的两种等价形式 ---------- */

  /** 改一边距：该边移动，对侧固定（夹取后广播） */
  function setMargin(side, px) {
    if (!active || !rect) return rect;
    const d = doc();
    const v = Math.max(0, Math.floor(px) || 0);
    const r = { ...rect };
    if (side === "left") {
      r.x = v;
      r.w = d.width - v - (d.width - (rect.x + rect.w));   // 右边距保持
    } else if (side === "right") {
      r.w = d.width - rect.x - v;                          // 左边距保持
    } else if (side === "top") {
      r.y = v;
      r.h = d.height - v - (d.height - (rect.y + rect.h)); // 下边距保持
    } else if (side === "bottom") {
      r.h = d.height - rect.y - v;                         // 上边距保持
    } else {
      return rect;
    }
    return setRect(r);
  }

  /** 改尺寸：左上锚定，右下让位 */
  function setSize(w, h) {
    if (!active || !rect) return rect;
    return setRect({
      x: rect.x, y: rect.y,
      w: w == null ? rect.w : Math.max(MIN, Math.floor(w) || 1),
      h: h == null ? rect.h : Math.max(MIN, Math.floor(h) || 1),
    });
  }

  function setRectPublic(x, y, w, h) {
    if (!active || !rect) return rect;
    return setRect({ x: x ?? rect.x, y: y ?? rect.y, w: w ?? rect.w, h: h ?? rect.h });
  }

  function getRect() { return rect ? { ...rect } : null; }

  function nudge(dx, dy) {
    if (!active || !rect) return;
    const d = doc();
    const x = Math.min(Math.max(0, rect.x + dx), d.width - rect.w);
    const y = Math.min(Math.max(0, rect.y + dy), d.height - rect.h);
    setRect({ ...rect, x, y });
  }

  /* ---------- 应用 / 取消 ---------- */

  function apply() {
    if (!active || !rect) return false;
    const d = doc();
    const r = clampRect(rect);
    if (r.w < 1 || r.h < 1) {
      IT.toast.warn("裁剪区域太小");
      return false;
    }
    const c = document.createElement("canvas");
    c.width = r.w;
    c.height = r.h;
    const cx = c.getContext("2d");
    cx.imageSmoothingEnabled = false;
    cx.translate(-r.x, -r.y);
    cx.drawImage(d.image, 0, 0);

    const v = S().view;                       // 让裁出的内容留在原来的屏幕位置
    S().setView(v.scale, v.x - r.x * v.scale, v.y - r.y * v.scale);
    S().replaceImage(c);
    exit(true);
    IT.bus.emit("notify", { message: `已裁剪为 ${r.w} × ${r.h} px` });
    return true;
  }

  /* ---------- 指针 ---------- */

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function handleAt(sx, sy) {
    if (!rect) return null;
    const p = VP().imageToScreen(rect.x, rect.y);
    const q = VP().imageToScreen(rect.x + rect.w, rect.y + rect.h);
    const near = (a, b) => Math.hypot(sx - a, sy - b) <= TOL;
    const inX = sx >= p.x - TOL && sx <= q.x + TOL;
    const inY = sy >= p.y - TOL && sy <= q.y + TOL;

    if (near(p.x, p.y)) return "nw";
    if (near(q.x, p.y)) return "ne";
    if (near(q.x, q.y)) return "se";
    if (near(p.x, q.y)) return "sw";
    if (Math.abs(sy - p.y) <= TOL && inX) return "n";
    if (Math.abs(sy - q.y) <= TOL && inX) return "s";
    if (Math.abs(sx - q.x) <= TOL && inY) return "e";
    if (Math.abs(sx - p.x) <= TOL && inY) return "w";
    if (sx > p.x && sx < q.x && sy > p.y && sy < q.y) return "move";
    return null;
  }

  function cursorFor(sx, sy) {
    if (!active || !rect) return null;
    const h = handleAt(sx, sy);
    if (h === "move" && isFull(rect)) return "crosshair";
    return h ? CURSORS[h] : "crosshair";
  }

  const isFull = (r) => {
    const d = doc();
    return r.x === 0 && r.y === 0 && r.w === d.width && r.h === d.height;
  };

  function onPointerDown(e, opts = {}) {
    if (!active || e.button !== 0 || opts.panForce || !rect) return false;
    e.preventDefault();
    const s = local(e);
    let h = handleAt(s.x, s.y);
    // 选区还是整幅 → 第一下应该是「框选」，而不是「移动整幅」
    if (h === "move" && isFull(rect)) h = null;
    const p = VP().screenToImage(s.x, s.y);
    drag = {
      mode: h || "new",
      sx: s.x, sy: s.y,
      ix: p.x, iy: p.y,
      origin: { ...rect },
    };
    if (!h) rect = { x: p.x, y: p.y, w: 1, h: 1 };   // 重新框选
    canvas.setPointerCapture(e.pointerId);
    VP().scheduleRender();
    return true;
  }

  function onPointerMove(e) {
    const s = local(e);
    if (!drag) return false;
    const p = VP().screenToImage(s.x, s.y);
    const dx = Math.round(p.x - drag.ix), dy = Math.round(p.y - drag.iy);

    if (drag.mode === "new") {
      const x1 = Math.round(drag.ix), y1 = Math.round(drag.iy);
      rect = clampRect({
        x: Math.min(x1, Math.round(p.x)),
        y: Math.min(y1, Math.round(p.y)),
        w: Math.abs(Math.round(p.x) - x1),
        h: Math.abs(Math.round(p.y) - y1),
      });
      emitRect();
    } else if (drag.mode === "move") {
      nudge(drag.origin.x + dx - rect.x, drag.origin.y + dy - rect.y);
      return true;
    } else {
      const o = drag.origin;
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      if (drag.mode.includes("w")) x1 += dx;
      if (drag.mode.includes("e")) x2 += dx;
      if (drag.mode.includes("n")) y1 += dy;
      if (drag.mode.includes("s")) y2 += dy;
      rect = clampRect({
        x: Math.min(x1, x2 - MIN), y: Math.min(y1, y2 - MIN),
        w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      });
      emitRect();
    }
    VP().scheduleRender();
    return true;
  }

  function onPointerUp(e) {
    if (!drag) return false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    if (drag.mode === "new") {
      const r = clampRect({ ...rect });
      // 只是单击了一下（没有真正画出框）→ 保持原选区，不要变成 1×1
      rect = (r.w <= 2 && r.h <= 2) ? drag.origin : r;
      emitRect();
    }
    drag = null;
    VP().scheduleRender();
    return true;
  }

  /* ---------- 叠加绘制 ---------- */

  function draw(ctx, view) {
    if (!active || !rect || !doc().image) return;
    const p = VP().imageToScreen(rect.x, rect.y);
    const q = VP().imageToScreen(rect.x + rect.w, rect.y + rect.h);
    const L = Math.round(p.x) + .5, T = Math.round(p.y) + .5;
    const R = Math.round(q.x) - .5, B = Math.round(q.y) - .5;
    const w = R - L, h = B - T;

    // 选区外压暗
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, view.box.w, view.box.h);
    ctx.rect(L, T, w, h);
    ctx.fillStyle = "rgba(14,20,30,.44)";
    ctx.fill("evenodd");
    ctx.restore();

    // 三分构图线
    if (w > 30 && h > 30) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const t of [1, 2]) {
        ctx.moveTo(Math.round(L + (w * t) / 3) + .5, T);
        ctx.lineTo(Math.round(L + (w * t) / 3) + .5, B);
        ctx.moveTo(L, Math.round(T + (h * t) / 3) + .5);
        ctx.lineTo(R, Math.round(T + (h * t) / 3) + .5);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 边框
    ctx.save();
    ctx.strokeStyle = "rgba(23,32,46,.55)";
    ctx.lineWidth = 3;
    ctx.strokeRect(L, T, w, h);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(L, T, w, h);
    ctx.restore();

    // 手柄
    const hs = 7, half = hs / 2;
    const pts = {
      nw: [L, T], n: [(L + R) / 2, T], ne: [R, T], e: [R, (T + B) / 2],
      se: [R, B], s: [(L + R) / 2, B], sw: [L, B], w: [L, (T + B) / 2],
    };
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(23,32,46,.6)";
    ctx.lineWidth = 1;
    for (const k of HANDLES) {
      const [cx, cy] = pts[k];
      ctx.fillRect(cx - half, cy - half, hs, hs);
      ctx.strokeRect(cx - half + .5, cy - half + .5, hs - 1, hs - 1);
    }
    ctx.restore();

    // 尺寸标签
    const label = `${rect.w} × ${rect.h}`;
    ctx.save();
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    const tw = ctx.measureText(label).width;
    const bx = L + 3, by = Math.max(2, T - 20);
    ctx.fillStyle = "rgba(23,32,46,.88)";
    ctx.fillRect(bx, by, tw + 10, 17);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + 5, by + 9);
    ctx.restore();
  }

  /* ---------- 装配 ---------- */

  function init(canvasEl) {
    canvas = canvasEl;
    VP().onOverlay(draw);
    IT.bus.on("doc:load", () => { if (active) exit(true); });
    IT.bus.on("doc:unload", () => exit(true));
    IT.bus.on("doc:meta", () => {          // 旋转等改变了尺寸：把选区夹回来
      if (active && rect) setRect(rect);
    });
    return { canvas };
  }

  return {
    init, enter, exit, toggle, isActive,
    getRect, setRect: setRectPublic, setMargin, setSize, nudge, apply,
    onPointerDown, onPointerMove, onPointerUp, cursorFor,
  };
})();
