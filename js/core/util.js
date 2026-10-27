/* ============================================================
   core/util.js — 通用工具
   ============================================================ */
window.IT = window.IT || {};

IT.util = (function () {
  "use strict";

  const util = {
    /** 夹取到 [min,max] */
    clamp(v, min, max) {
      return v < min ? min : v > max ? max : v;
    },

    /** 是否数值 */
    isNum(v) {
      return typeof v === "number" && Number.isFinite(v);
    },

    /** 千分位整数 */
    int(n) {
      return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";
    },

    /** 字节体积友好显示 */
    bytes(n) {
      if (!Number.isFinite(n) || n <= 0) return "";
      const k = 1024;
      const units = ["B", "KB", "MB", "GB"];
      let i = 0;
      while (n >= k && i < units.length - 1) { n /= k; i++; }
      return (n >= 100 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 2)) + " " + units[i];
    },

    /** 百分比文案：< 10% 保留一位小数 */
    percent(scale) {
      const p = scale * 100;
      return p < 10 ? p.toFixed(1) : String(Math.round(p));
    },

    /** 文件扩展名（小写，不含点） */
    ext(name) {
      const m = /\.([a-z0-9]+)$/i.exec(name || "");
      return m ? m[1].toLowerCase() : "";
    },

    /** 去扩展名的文件名 */
    stem(name) {
      return String(name || "").replace(/\.[^.]+$/, "");
    },

    /**
     * rAF 合并调度：同一帧内多次 request 只执行一次。
     * 返回的函数再次调用即安排下一帧。
     */
    raf(fn) {
      let queued = false;
      return function schedule() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          fn();
        });
      };
    },

    /** 简易 debounce */
    debounce(fn, wait = 150) {
      let t = 0;
      return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
      };
    },
  };

  return util;
})();
