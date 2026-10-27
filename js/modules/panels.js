/* ============================================================
   modules/panels.js — 浮动参数面板
     #crop-panel    预备裁剪模式的参数面板
     #rotate-panel  旋转 / 镜像面板（工具栏「旋转」显示/隐藏）
   两块面板浮在呈现区之上，可用标题条拖动。
   边距 ⇄ 尺寸 的换算规则全部落在 crop.js，这里只做双向绑定。
   ============================================================ */
window.IT = window.IT || {};

IT.panels = (function () {
  "use strict";

  const el = {};
  const FIELDS = [
    ["top", "crop-top"], ["bottom", "crop-bottom"],
    ["left", "crop-left"], ["right", "crop-right"],
    ["w", "crop-w"], ["h", "crop-h"],
  ];

  function init() {
    el.crop = document.getElementById("crop-panel");
    el.rotate = document.getElementById("rotate-panel");
    el.meta = document.getElementById("crop-meta");
    el.inputs = new Map(FIELDS.map(([k, id]) => [k, document.getElementById(id)]));

    // 裁剪面板
    for (const [key, node] of el.inputs) {
      node.addEventListener("input", () => commit(key));
      node.addEventListener("change", () => commit(key));
      node.addEventListener("blur", () => resync());
      node.addEventListener("keydown", (e) => {
        e.stopPropagation();            // 不要误触全局快捷键
        if (e.key === "Escape") IT.crop.exit();
        else if (e.key === "Enter") { commit(key); node.blur(); }
      });
      node.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    }

    document.getElementById("crop-apply").addEventListener("click", () => IT.crop.apply());
    document.getElementById("crop-cancel").addEventListener("click", () => IT.crop.exit());
    document.getElementById("crop-close").addEventListener("click", () => IT.crop.exit());

    // 旋转面板
    const ops = [
      ["rot-ccw", () => IT.transform.rotate(-90)],
      ["rot-cw", () => IT.transform.rotate(90)],
      ["mir-h", () => IT.transform.mirror("h")],
      ["mir-v", () => IT.transform.mirror("v")],
    ];
    for (const [id, fn] of ops) {
      document.getElementById(id).addEventListener("click", fn);
    }
    document.getElementById("rotate-close").addEventListener("click", () => setRotate(false));
    el.rotate.addEventListener("keydown", (e) => e.stopPropagation());

    makeDraggable(el.crop);
    makeDraggable(el.rotate);

    IT.bus.on("crop:enter", showCrop);
    IT.bus.on("crop:exit", () => hide(el.crop));
    IT.bus.on("crop:rect", onRect);
    IT.bus.on("doc:load", () => setRotate(false));
    IT.bus.on("doc:unload", () => setRotate(false));
    return el;
  }

  /* ---------- 面板显隐 ---------- */

  function show(node) {
    node.hidden = false;
    node.classList.remove("pop");
    void node.offsetWidth;              // 重启动画
    node.classList.add("pop");
  }
  function hide(node) { node.hidden = true; }

  function showCrop() { show(el.crop); resync(); }

  /** 面板开合的单一出口：广播出去，工具栏按钟才知道它关了 */
  function setRotate(open) {
    if (open) show(el.rotate); else hide(el.rotate);
    IT.bus.emit("rotate:panel", { open: !!open });
  }

  function toggleRotate() {
    setRotate(el.rotate.hidden);
    return !el.rotate.hidden;
  }

  const rotateVisible = () => !el.rotate.hidden;

  /* ---------- 双向绑定 ---------- */

  /** 面板 → 模型 */
  function commit(key) {
    const node = el.inputs.get(key);
    const raw = node.value.trim();
    if (raw === "") return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    if (key === "w" || key === "h") {
      IT.crop.setSize(key === "w" ? v : null, key === "h" ? v : null);
    } else {
      IT.crop.setMargin(key, v);
    }
  }

  /** 模型 → 面板（跳过正在输入的那个，避免打断） */
  function resync(data) {
    const r = data || IT.crop.getRect();
    if (!r) return;
    for (const [key, node] of el.inputs) {
      if (document.activeElement === node) continue;
      const val = key === "w" ? r.w : key === "h" ? r.h : margin(r, key);
      if (String(node.value) !== String(val)) node.value = val;
    }
    const d = IT.state.doc;
    if (el.meta) {
      el.meta.textContent = `${d.width} × ${d.height} px`;
      el.meta.title = `原图 ${d.width} × ${d.height}\n选区 x:${r.x ?? 0} y:${r.y ?? 0} · ${r.w} × ${r.h}`;
    }
  }

  function margin(r, side) {
    const d = IT.state.doc;
    if (side === "left") return r.x ?? 0;
    if (side === "right") return Math.max(0, d.width - ((r.x ?? 0) + r.w));
    if (side === "top") return r.y ?? 0;
    return Math.max(0, d.height - ((r.y ?? 0) + r.h));
  }

  function onRect(data) {
    resync({
      x: data.x, y: data.y, w: data.w, h: data.h,
    });
  }

  /* ---------- 可拖动 ---------- */

  function makeDraggable(node) {
    const head = node.querySelector(".fpanel-head");
    if (!head) return;
    let grab = null;

    head.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = node.getBoundingClientRect();
      grab = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
      node.style.right = "auto";            // 改成 left/top 定位，免得 left+right 同时生效
      node.style.bottom = "auto";
      node.classList.add("moving");
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    head.addEventListener("pointermove", (e) => {
      if (!grab || grab.id !== e.pointerId) return;
      const host = node.parentElement.getBoundingClientRect();
      const x = e.clientX - host.left - grab.dx;
      const y = e.clientY - host.top - grab.dy;
      node.style.left = Math.max(4, Math.min(host.width - grab.w - 4, x)) + "px";
      node.style.top = Math.max(4, Math.min(host.height - grab.h - 4, y)) + "px";
    });

    const end = (e) => {
      if (!grab) return;
      try { head.releasePointerCapture(e.pointerId); } catch (_) {}
      grab = null;
      node.classList.remove("moving");
    };
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  }

  return { init, toggleRotate, showCrop, rotateVisible, el };
})();
