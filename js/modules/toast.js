/* ============================================================
   modules/toast.js — 轻量提示条
   ============================================================ */
window.IT = window.IT || {};

IT.toast = (function () {
  "use strict";

  let el = null;
  let timer = 0;
  let hideTimer = 0;

  function ensure() {
    if (el) return el;
    el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.appendChild(el);
    }
    return el;
  }

  function show(message, kind = "", ms = 2200) {
    const n = ensure();
    n.textContent = message || "";
    n.className = "show" + (kind ? " " + kind : "");
    clearTimeout(hideTimer);
    clearTimeout(timer);
    timer = setTimeout(() => { n.className = ""; }, ms);
    return n;
  }

  /** 错误类提示停留更久 */
  function warn(message) {
    return show(message, "warn", 4200);
  }

  return { show, warn };
})();
