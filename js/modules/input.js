/* ============================================================
   modules/input.js — 呈现区交互
   左/中键拖动 = 平移   滚轮 = 缩放   Shift+滚轮 = 水平平移
   Alt+滚轮 = 垂直平移   双击 = 适应/100% 切换
   Ctrl+滚轮 = 缩放（触控板捏合）   Space+拖动 = 强制平移
   ============================================================ */
window.IT = window.IT || {};

IT.input = (function () {
  "use strict";

  const cfg = IT.config;
  let canvas = null;
  let drag = null;
  let spaceDown = false;

  function init(canvasEl) {
    canvas = canvasEl;
    const ws = canvas.parentElement;

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("contextmenu", (e) => { if (drag) e.preventDefault(); });
    canvas.addEventListener("wheel", onWheel, { passive: false });

    ws.addEventListener("dragover", onDragOver);
    ws.addEventListener("drop", onDrop);
    window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener("drop", (e) => {
      if (!ws.contains(e.target)) document.body.classList.remove("dragover");
    });

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("paste", onPaste);

    return { canvas };
  }

  const rect = () => canvas.getBoundingClientRect();

  /* ---------- 光标坐标 (B2) ---------- */

  function emitCursor(e) {
    const r = rect();
    const p = IT.viewport.screenToImage(e.clientX - r.left, e.clientY - r.top);
    const d = IT.state.doc;
    const inside = !!d.image
      && p.x >= 0 && p.y >= 0 && p.x < d.width && p.y < d.height;
    IT.state.cursor = { x: p.x, y: p.y, inside };
    IT.bus.emit("cursor:move", { x: p.x, y: p.y, inside });
  }

  /* ---------- 拖动：平移 or 裁剪 ---------- */

  /** 当前指针归属：null | "pan" | "crop" */
  let mode = null;

  function onDown(e) {
    if (!IT.state.doc.image) return;
    const middle = e.button === 1;
    const left = e.button === 0;
    if (!(left || middle)) return;
    const forcePan = middle || spaceDown || e.altKey;

    // 裁剪模式下左键交给裁剪层；Space / 中键 / Alt 仍可平移
    if (left && !forcePan && IT.crop && IT.crop.isActive()
      && IT.crop.onPointerDown(e, { panForce: false })) {
      mode = "crop";
      return;
    }

    if (middle) e.preventDefault();          // 阻止中键自动滚动
    mode = "pan";
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, force: forcePan };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
  }

  function onMove(e) {
    if (mode === "crop") {
      IT.crop.onPointerMove(e);
      emitCursor(e);
      return;
    }
    if (mode === "pan" && drag && drag.id === e.pointerId) {
      IT.viewport.pan(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX;
      drag.y = e.clientY;
    } else if (!mode && !drag) {
      // 光标形状：裁剪模式下看手柄，否则交还给 CSS 类
      const r = rect();
      const want = IT.crop && IT.crop.isActive() && !spaceDown
        ? (IT.crop.cursorFor(e.clientX - r.left, e.clientY - r.top) || "crosshair")
        : "";
      if (canvas.style.cursor !== want) canvas.style.cursor = want;
    }
    emitCursor(e);
  }

  function onUp(e) {
    if (mode === "crop") {
      IT.crop.onPointerUp(e);
      canvas.style.cursor = "";
    } else if (mode === "pan" && drag && drag.id === e.pointerId) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      canvas.classList.remove("dragging");
      drag = null;
    }
    mode = null;
  }

  function onLeave() {
    if (drag || mode) return;
    IT.state.cursor = { x: null, y: null, inside: false };
    IT.bus.emit("cursor:move", { x: null, y: null, inside: false });
  }

  /* ---------- 滚轮缩放 ---------- */

  function onWheel(e) {
    e.preventDefault();
    if (!IT.state.doc.image) return;

    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const dy = e.deltaY * unit;
    const dx = e.deltaX * unit;
    const r = rect();

    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {          // 水平平移
      IT.viewport.pan(-(dx || dy), 0);
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {            // 垂直平移
      IT.viewport.pan(0, -(dy || dx));
      return;
    }

    // 捏合 / 垂直滚轮 → 以指针为锚点缩放；横向滚动 → 水平平移
    if (Math.abs(dy) >= Math.abs(dx)) {
      const factor = Math.exp(-dy * 0.0018);
      IT.viewport.zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
    } else {
      IT.viewport.pan(-dx, 0);
    }
    emitCursor(e);
  }

  function onDblClick(e) {
    if (!IT.state.doc.image || (IT.crop && IT.crop.isActive())) return;
    const s = IT.state.view.scale;
    if (Math.abs(s - 1) < 1e-3 || !IT.viewport.isFitted()) IT.viewport.fit();
    else IT.viewport.zoom100();
  }

  /* ---------- 拖放文件 ---------- */

  const hasFiles = (e) =>
    e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");

  function onDragOver(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    document.body.classList.add("dragover");
  }

  async function onDrop(e) {
    document.body.classList.remove("dragover");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    await IT.fileio.loadFile(file, null);
  }

  /* ---------- 剪贴板粘贴 ---------- */

  async function onPaste(e) {
    if (isFormField(e.target)) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          await IT.fileio.loadFile(file, null);
          return;
        }
      }
    }
  }

  /* ---------- 键盘 ---------- */

  function isFormField(node) {
    return node && /^(input|textarea|select|button)$/i.test(node.tagName);
  }

  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const typing = isFormField(e.target);

    if (e.code === "Space" && !typing) {
      spaceDown = true;
      canvas.classList.toggle("pan-mode", true);
      e.preventDefault();
      return;
    }

    /* 裁剪模式：以下操作不需要修饰键 */
    const cropping = !!(IT.crop && IT.crop.isActive());
    if (!mod && !typing) {
      if (cropping) {
        if (e.key === "Escape") { e.preventDefault(); IT.crop.exit(); return; }
        if (e.key === "Enter") { e.preventDefault(); IT.crop.apply(); return; }
        if (e.key.indexOf("Arrow") === 0) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          IT.crop.nudge(
            e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0,
            e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0);
          return;
        }
      }
      if (e.key.toLowerCase() === "c") {
        if (IT.state.doc.image) { e.preventDefault(); IT.crop.toggle(); IT.toolbar.syncMode(); }
        return;
      }
    }

    // Esc 收起旋转面板
    if (e.key === "Escape" && !typing && IT.panels.rotateVisible()) {
      IT.panels.toggleRotate();
      return;
    }

    if (!mod) return;
    const k = e.key.toLowerCase();

    if (k === "o" && !e.shiftKey) { e.preventDefault(); IT.fileio.openWithPicker().catch(log); }
    else if (k === "s") {
      e.preventDefault();
      (e.shiftKey ? IT.fileio.saveAs() : IT.fileio.save()).catch(log);
    } else if (k === "0") { e.preventDefault(); IT.viewport.fit(); }
    else if (k === "1") { e.preventDefault(); IT.viewport.zoom100(); }
    else if (k === "=" || k === "+") { e.preventDefault(); IT.viewport.zoomBy(cfg.ZOOM_STEP); }
    else if (k === "-" || k === "_") { e.preventDefault(); IT.viewport.zoomBy(1 / cfg.ZOOM_STEP); }
  }

  function onKeyUp(e) {
    if (e.code === "Space") {
      spaceDown = false;
      canvas.classList.toggle("pan-mode", false);
    }
  }

  function log(err) {
    console.error(err);
    IT.toast.warn(`操作失败：${err && err.message ? err.message : err}`);
  }

  return { init };
})();
