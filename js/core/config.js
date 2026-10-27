/* ============================================================
   core/config.js — 常量与映射
   ============================================================ */
window.IT = window.IT || {};

IT.config = (function () {
  "use strict";

  const MIN_SCALE = 0.01;   //   1 %
  const MAX_SCALE = 16;     // 1600 %
  const SLIDER_MAX = 1000;  // slider 整数刻度数（对数映射）

  const lnMin = Math.log(MIN_SCALE);
  const lnMax = Math.log(MAX_SCALE);
  const span = lnMax - lnMin;

  const api = {
    MIN_SCALE,
    MAX_SCALE,
    SLIDER_MAX,

    /** 步进缩放使用的系数 */
    ZOOM_STEP: 1.25,

    /** 常用档位：slider 就近吸附，也用于快捷键 */
    PRESETS: [1 / 16, 1 / 8, 1 / 4, 0.5, 1, 2, 4, 8],

    /** 吸附容差（相对值） */
    SNAP_TOLERANCE: 0.008,

    /** 缩放在 [MIN,MAX] 内可用，越界则夹取 */
    clampScale(s) {
      return IT.util.clamp(s, MIN_SCALE, MAX_SCALE);
    },

    /** 若接近常用档位则返回精确档位，便于 B3 对齐 100%/25% 等 */
    snapScale(s) {
      for (const p of api.PRESETS) {
        if (Math.abs(s / p - 1) < api.SNAP_TOLERANCE) return p;
      }
      return s;
    },

    /** slider(0..SLIDER_MAX) → scale，对数等比 */
    sliderToScale(v) {
      const t = IT.util.clamp(v / SLIDER_MAX, 0, 1);
      return Math.exp(lnMin + t * span);
    },

    /** scale → slider(0..SLIDER_MAX) */
    scaleToSlider(s) {
      const t = (Math.log(IT.util.clamp(s, MIN_SCALE, MAX_SCALE)) - lnMin) / span;
      return Math.round(IT.util.clamp(t, 0, 1) * SLIDER_MAX);
    },

    /** 透明棋盘：方格边长(px) 与两色（浅色环境） */
    CHECK: {
      size: 10,
      a: "#ffffff",
      b: "#e8ebf1",
    },

    /** 适应窗口时预留边距 */
    FIT_PADDING: 28,

    /** 适应窗口允许放大的上限 */
    FIT_MAX: 8,
  };

  return api;
})();
