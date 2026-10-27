/* ============================================================
   modules/transform.js — 无损几何变换：旋转 90° / 镜像
   在图像坐标系内重画一次，尺寸按需交换；视图保持视觉中心不动。
   ============================================================ */
window.IT = window.IT || {};

IT.transform = (function () {
  "use strict";

  const MIN = 1;

  /** 交换宽高时的视图锚点补偿：让图片中心留在原处 */
  function keepCenter(oldW, oldH, newW, newH) {
    const v = IT.state.view;
    IT.state.setView(v.scale,
      v.x + (oldW - newW) * v.scale / 2,
      v.y + (oldH - newH) * v.scale / 2);
  }

  function canvasOf(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(MIN, Math.round(w));
    c.height = Math.max(MIN, Math.round(h));
    return c;
  }

  /**
   * @param {number} dir  +90 顺时针 / -90 逆时针 / 180
   */
  function rotate(dir = 90) {
    const d = IT.state.doc;
    if (!d.image) return false;
    const w = d.width, h = d.height;
    const swap = Math.abs(dir) === 90;
    const c = canvasOf(swap ? h : w, swap ? w : h);
    const cx = c.getContext("2d");
    cx.imageSmoothingEnabled = false;
    cx.translate(c.width / 2, c.height / 2);
    cx.rotate((dir * Math.PI) / 180);
    cx.drawImage(d.image, -w / 2, -h / 2);
    keepCenter(w, h, c.width, c.height);
    IT.state.replaceImage(c, { type: d.type });
    IT.bus.emit("notify", {
      message: `已${dir === 180 ? "旋转 180°" : dir > 0 ? "顺时针旋转 90°" : "逆时针旋转 90°"}`,
    });
    return true;
  }

  /** @param {"h"|"v"} axis  h = 水平镜像（左右翻转） */
  function mirror(axis) {
    const d = IT.state.doc;
    if (!d.image) return false;
    const c = canvasOf(d.width, d.height);
    const cx = c.getContext("2d");
    cx.imageSmoothingEnabled = false;
    cx.save();
    if (axis === "h") { cx.translate(c.width, 0); cx.scale(-1, 1); }
    else { cx.translate(0, c.height); cx.scale(1, -1); }
    cx.drawImage(d.image, 0, 0);
    cx.restore();
    IT.state.replaceImage(c, { type: d.type });
    IT.bus.emit("notify", { message: axis === "h" ? "已水平镜像" : "已垂直镜像" });
    return true;
  }

  return { rotate, mirror };
})();
