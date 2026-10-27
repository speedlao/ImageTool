/* ============================================================
   modules/fileio.js — 文件：打开 / 保存 / 另存为
   优先使用 File System Access API（可回写原文件），
   降级为 <a download> 下载。
   ============================================================ */
window.IT = window.IT || {};

IT.fileio = (function () {
  "use strict";

  const util = IT.util;

  /** 扩展名 → MIME */
  const MIME_BY_EXT = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
    svg: "image/svg+xml", avif: "image/avif",
  };

  const PICK_TYPES = [
    { description: "图片", accept: {
      "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"], "image/gif": [".gif"],
      "image/bmp": [".bmp"], "image/avif": [".avif"],
      "image/svg+xml": [".svg"],
    } },
    { description: "所有文件", accept: { "application/octet-stream": [] } },
  ];

  const SAVE_TYPES = {
    "image/png":  { description: "PNG 图像", accept: { "image/png": [".png"] } },
    "image/jpeg": { description: "JPEG 图像", accept: { "image/jpeg": [".jpg", ".jpeg"] } },
    "image/webp": { description: "WebP 图像", accept: { "image/webp": [".webp"] } },
  };

  function pickSave(suggested, types) {
    return window.showSaveFilePicker({ suggestedName: suggested, types })
      .catch(handleAbort);
  }

  function handleAbort(err) {
    if (err && err.name === "AbortError") return null;
    throw err;
  }

  const supportsPicker = () => typeof window.showSaveFilePicker === "function";

  /* ================= 打开 ================= */

  /** 弹出打开对话框；取消返回 null */
  async function openWithPicker() {
    if (window.showOpenFilePicker) {
      const handles = await window.showOpenFilePicker({
        multiple: false,
        types: PICK_TYPES,
      }).catch(handleAbort);
      if (!handles || !handles.length) return null;
      const file = await handles[0].getFile();
      return loadFile(file, handles[0]);
    }
    const files = await pickFallback();
    if (!files || !files.length) return null;
    return loadFile(files[0], null);
  }

  /** 无 File System Access API 时借 <input type=file> */
  function pickFallback() {
    const input = document.getElementById("file-input");
    input.value = "";
    return new Promise((resolve) => {
      const done = (files) => {
        input.onchange = input.oncancel = null;
        resolve(files && files.length ? [...files] : null);
      };
      input.onchange = () => done(input.files);
      input.oncancel = () => done(null);
      input.click();
    });
  }

  /**
   * 载入一个 File / Blob。
   * @returns {Promise<object|null>} 文档 meta，失败或取消返回 null
   */
  async function loadFile(file, handle) {
    if (!file) return null;
    if (file.type && !file.type.startsWith("image/")) {
      notify(`不支持的文件类型：${file.type || util.ext(file.name) || "未知"}`, "warn");
      return null;
    }

    const url = URL.createObjectURL(file);
    try {
      const image = await decode(url);
      IT.state.setDoc(image, {
        name: file.name || "未命名",
        type: file.type || image.type,
        bytes: file.size || 0,
        handle: handle && handle.createWritable ? handle : null,
        source: file,
      });
      IT.bus.emit("notify", {
        message: `已打开 ${file.name} · ${util.int(image.naturalWidth)}×${util.int(image.naturalHeight)}`,
      });
      return IT.state.doc;
    } catch (err) {
      notify(`无法读取图片：${err.message}`, "warn");
      return null;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function decode(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("解码失败"));
      img.src = url;
    });
  }

  /* ================= 保存 ================= */

  /** 保存：有 handle 就原地写入，否则退化为“另存为” */
  async function save() {
    const d = IT.state.doc;
    if (!d.image) return false;
    if (!d.handle) return saveAs();
    try {
      const mime = MIME_BY_EXT[util.ext(d.name)] || d.type || "image/png";
      const blob = await payload(d, mime);
      const w = await d.handle.createWritable();
      await w.write(blob);
      await w.close();
      Object.assign(d, { source: blob, bytes: blob.size, dirty: false });
      emitMeta();
      notify(`已保存 ${d.name}`);
      return true;
    } catch (err) {
      if (err && err.name === "AbortError") return false;
      notify(`原地保存失败，请使用“另存”：${err && err.name ? err.name : err.message}`, "warn");
      return false;
    }
  }

  /** 另存为：优先保留原始字节（M1 无编辑 = 无损） */
  async function saveAs() {
    const d = IT.state.doc;
    if (!d.image) return false;

    const mime = MIME_BY_EXT[util.ext(d.name)] || d.type || "image/png";
    const base = util.stem(d.name) || "image";
    const ext = extOf(mime);

    if (supportsPicker()) {
      const types = [SAVE_TYPES[mime] || SAVE_TYPES["image/png"]];
      const handle = await pickSave(`${base}${ext}`, types);
      if (!handle) return false;
      try {
        const blob = await payload(d, mime);
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        Object.assign(d, {
          name: handle.name || `${base}${ext}`,
          handle, source: blob, type: blob.type || mime, bytes: blob.size, dirty: false,
        });
        emitMeta();
        IT.bus.emit("notify", { message: `已另存为 ${d.name}` });
        return true;
      } catch (err) {
        if (err.name !== "AbortError") notify(`另存失败：${err.message}`, "warn");
        return false;
      }
    }

    // 降级：下载到默认下载目录
    const blob = await payload(d, mime);
    const name = `${base}${ext}`;
    download(blob, name);
    Object.assign(d, { name, dirty: false });
    emitMeta();
    IT.bus.emit("notify", { message: `已导出 ${name}` });
    return true;
  }

  /** 仅元信息变化（不触发 fit 等文档级重置） */
  function emitMeta() {
    IT.bus.emit("doc:meta", { ...IT.state.doc });
  }

  /** 落盘内容：无损优先用原始 Blob */
  function payload(d, mime) {
    if (d.source && (d.source.type || "") === mime) return Promise.resolve(d.source);
    return toBlob(d, mime);
  }

  function toBlob(d, mime = "image/png", quality = 0.95) {
    return new Promise((resolve, reject) => {
      const c = document.createElement("canvas");
      c.width = d.width;
      c.height = d.height;
      const cx = c.getContext("2d");
      if (/^image\/(jpeg|jpg)$/.test(mime)) {   // JPEG 无 alpha，填白
        cx.fillStyle = "#ffffff";
        cx.fillRect(0, 0, c.width, c.height);
      }
      cx.drawImage(d.image, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("编码失败"))), mime, quality);
    });
  }

  function extOf(mime) {
    const hit = Object.entries(MIME_BY_EXT).find(([, m]) => m === mime);
    return "." + (hit ? hit[0] : "png");
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function notify(message, kind) {
    IT.bus.emit("notify", { message, kind });
  }

  return {
    openWithPicker, loadFile, save, saveAs, pickFallback, supportsPicker,
  };
})();
