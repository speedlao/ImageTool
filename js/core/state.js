/* ============================================================
   core/state.js — 应用状态（单一数据源）
   ============================================================ */
window.IT = window.IT || {};

IT.state = (function () {
  "use strict";

  const state = {
    /** 当前文档 */
    doc: {
      image: null,      // HTMLImageElement
      width: 0,
      height: 0,
      name: "",         // 文件名
      type: "",         // MIME
      bytes: 0,         // 字节数
      handle: null,     // FileSystemFileHandle（可回写时）
      source: null,     // 原始 Blob（M1 无编辑，直接落盘即可）
      dirty: false,
    },

    /** 视口变换：CSS 像素，屏幕 = 图片坐标 * scale + (x,y) */
    view: {
      scale: 1,
      x: 0,
      y: 0,
    },

    /** 光标 */
    cursor: { x: null, y: null, inside: false },
  };

  /** 载入一张已解码的图片 */
  state.setDoc = function (image, meta = {}) {
    const d = state.doc;
    d.image = image;
    d.width = image.naturalWidth || image.width;
    d.height = image.naturalHeight || image.height;
    d.name = meta.name ?? "";
    d.type = meta.type || image.type || "";
    d.bytes = meta.bytes ?? 0;
    d.handle = meta.handle ?? null;
    d.source = meta.source ?? null;
    d.dirty = false;
    IT.bus.emit("doc:load", { image, meta: d });
  };

  state.clearDoc = function () {
    const d = state.doc;
    Object.assign(d, {
      image: null, width: 0, height: 0, name: "", type: "",
      bytes: 0, handle: null, source: null, dirty: false,
    });
    IT.bus.emit("doc:unload", {});
  };

  /**
   * 就地替换图像（裁剪 / 旋转 / 镜像等编辑操作）。
   * 保留文件名与写句柄，但原始字节作废 —— 保存时需重新编码。
   */
  state.replaceImage = function (image, meta = {}) {
    const d = state.doc;
    d.image = image;
    d.width = image.naturalWidth || image.width || 0;
    d.height = image.naturalHeight || image.height || 0;
    Object.assign(d, meta);
    d.source = null;
    d.dirty = true;
    IT.bus.emit("doc:meta", { ...d });
    IT.bus.emit("view:change", { ...state.view });
  };

  /** 更新视口并广播 */
  state.setView = function (scale, x, y) {
    const v = state.view;
    v.scale = IT.config.clampScale(scale);
    v.x = x;
    v.y = y;
    IT.bus.emit("view:change", { ...v });
  };

  return state;
})();
