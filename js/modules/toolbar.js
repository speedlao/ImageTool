/* ============================================================
   modules/toolbar.js — 顶部工具栏交互
   工具栏 1 文件 / 2 裁剪·旋转 = 已实现；3 缩放 / 4 颜色 = 占位提示
   ============================================================ */
window.IT = window.IT || {};

IT.toolbar = (function () {
  "use strict";

  const TODO_HINT = {
    zoom:  "M3 · 缩放面板尚未实现（缩放已在状态栏 B3）",
    color: "M4 · 颜色/滤镜工具尚未实现",
  };

  let els = {};

  function init() {
    els.docname = document.getElementById("doc-name");
    els.open = document.getElementById("btn-open");
    els.save = document.getElementById("btn-save");
    els.saveas = document.getElementById("btn-saveas");
    els.crop = document.getElementById("btn-crop");
    els.rotate = document.getElementById("btn-rotate");

    els.open.addEventListener("click", () => {
      IT.fileio.openWithPicker().catch(reportError);
    });

    els.save.addEventListener("click", () => {
      IT.fileio.save().catch(reportError);
    });

    els.saveas.addEventListener("click", () => {
      IT.fileio.saveAs().catch(reportError);
    });

    els.crop.addEventListener("click", () => {
      IT.crop.toggle();
      syncMode();
    });

    els.rotate.addEventListener("click", () => IT.panels.toggleRotate());

    // 未实现分组：整块点击给出路线图提示
    document.querySelectorAll(".toolgroup.is-todo").forEach((g) => {
      const key = g.dataset.group;
      g.addEventListener("click", (e) => {
        e.preventDefault();
        IT.toast.show(TODO_HINT[key] || "功能开发中", "warn", 2600);
      });
    });

    IT.bus.on("doc:load", () => { refresh(); syncMode(); });
    IT.bus.on("doc:meta", refresh);
    IT.bus.on("doc:unload", () => { refresh(); syncMode(); });
    IT.bus.on("crop:enter", syncMode);
    IT.bus.on("crop:exit", syncMode);
    // 面板可能被浮窗上的 ✕ 或 Esc 关掉，按钟状态一律跟着面板走
    IT.bus.on("rotate:panel", (d) => {
      els.rotate.classList.toggle("active", !!d.open);
      els.rotate.setAttribute("aria-expanded", String(!!d.open));
    });
    refresh();
  }

  function reportError(err) {
    console.error(err);
    IT.toast.warn(`操作失败：${err && err.message ? err.message : err}`);
  }

  /** 裁剪模式的按钟状态 */
  function syncMode() {
    const on = IT.crop.isActive();
    els.crop.classList.toggle("active", on);
    els.crop.setAttribute("aria-pressed", String(on));
    els.crop.title = on ? "退出裁剪 (C / Esc)" : "裁剪 (C) · 框选后进入预备裁剪";
    document.body.classList.toggle("crop-mode", on);
  }

  /** 依据文档状态刷新工具栏 */
  function refresh() {
    const d = IT.state.doc;
    const has = !!d.image;
    els.save.disabled = !has;
    els.saveas.disabled = !has;
    els.crop.disabled = !has;
    els.rotate.disabled = !has;

    if (has) {
      els.docname.textContent = d.name || "未命名";
      els.docname.classList.add("active");
      els.docname.classList.toggle("dirty", !!d.dirty);
      els.docname.title = (d.name || "未命名") + (d.dirty ? " · 有未保存的修改" : "");
    } else {
      els.docname.textContent = "未命名";
      els.docname.classList.remove("active");
      els.docname.classList.remove("dirty");
      els.docname.title = "尚未打开文件";
      els.rotate.classList.remove("active");
      els.rotate.setAttribute("aria-expanded", "false");
    }
  }

  return { init, refresh, syncMode };
})();
