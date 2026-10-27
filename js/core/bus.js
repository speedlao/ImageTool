/* ============================================================
   core/bus.js — 模块间事件总线
   事件约定：
     doc:load     { image, meta }
     doc:unload   {}
     view:change  { scale, x, y }   视口变换
     view:render  {}                已重绘
     cursor:move  { x, y, inside }  图片坐标
     scale:change { scale }
     status:dirty {}                状态栏需整体刷新
     notify       { message, kind } 提示
   ============================================================ */
window.IT = window.IT || {};

IT.bus = (function () {
  "use strict";

  const map = new Map();

  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => this.off(evt, fn);
    },

    off(evt, fn) {
      const set = map.get(evt);
      if (set) set.delete(fn);
    },

    emit(evt, data) {
      const set = map.get(evt);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(data);
        } catch (err) {
          console.error("[bus]", evt, err);
        }
      }
    },
  };
})();
