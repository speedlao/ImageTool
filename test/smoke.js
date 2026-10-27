/* ============================================================
   test/smoke.js — 无浏览器冒烟测试
   用 DOM 替身在 Node vm 沙箱里加载全部模块，然后像用户一样
   派发事件：校验加载、跨模块引用、HTML 契约、几何变换、
   状态栏文本，以及键盘 / 滚轮 / 拖动 / slider 的实际接线。
   运行： node test/smoke.js      （VERBOSE_API=1 打印 API 面）
   ============================================================ */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const files = [
  "js/core/util.js", "js/core/config.js", "js/core/bus.js", "js/core/state.js",
  "js/modules/viewport.js", "js/modules/statusbar.js", "js/modules/toast.js",
  "js/modules/fileio.js", "js/modules/crop.js", "js/modules/transform.js",
  "js/modules/panels.js", "js/modules/toolbar.js", "js/modules/input.js",
  "js/main.js",
];

const noop = () => {};

/* ---------------- DOM 替身 ---------------- */
const registry = new Map();
const domReady = [];

function stubEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    value: "", textContent: "", title: "", disabled: false, className: "",
    hidden: false, offsetWidth: 120, offsetHeight: 40,
    min: 0, max: 100, step: 1, files: null, dataset: {},
    style: { setProperty: noop, display: "" },
    classList: {
      add() { el.className = addCls(el.className, arguments[0]); },
      remove() { el.className = delCls(el.className, arguments[0]); },
      toggle(c, on) { if (on === undefined) on = !el.classList.contains(c); el.className = on ? addCls(el.className, c) : delCls(el.className, c); },
      contains(c) { return el.className.split(/\s+/).includes(c); },
    },
    __h: {},
    __q: {},
    addEventListener(type, fn) { (el.__h[type] = el.__h[type] || []).push(fn); },
    removeEventListener: noop,
    appendChild: noop, removeChild: noop, remove: noop,
    click() { fire(el, "click", { target: el }); },
    blur: noop, focus: noop, select: noop,
    setPointerCapture: noop, releasePointerCapture: noop,
    setAttribute(k, v) { el["__attr_" + k] = String(v); },
    getAttribute(k) { return el["__attr_" + k] ?? null; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(el, "__attr_" + k); },
    contains: () => false,
    closest: () => null,
    querySelector: (s) => el.__q[s] || null,
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    getContext: () => ({
      setTransform: noop, clearRect: noop, drawImage: noop, fillRect: noop,
      strokeRect: noop, beginPath: noop, rect: noop, clip: noop, save: noop,
      restore: noop, translate: noop, rotate: noop, scale: noop,
      moveTo: noop, lineTo: noop, closePath: noop, stroke: noop, fill: noop,
      fillText: noop, strokeText: noop, measureText: () => ({ width: 42 }),
      createPattern: () => ({}),
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textBaseline: "",
      globalAlpha: 1, lineJoin: "miter", lineCap: "butt",
      imageSmoothingEnabled: true, imageSmoothingQuality: "low",
    }),
  };
  Object.defineProperty(el, "parentElement", {
    get() { if (!el._p) el._p = stubEl(); return el._p; }, configurable: true,
  });
  return el;
}

/** 浮窗替身：带 .fpanel-head 标题条，初始隐藏（HTML 上有 hidden 属性） */
function panelStub(id) {
  const p = stubEl("div");
  p.hidden = true;
  p.__q = { ".fpanel-head": stubEl("div") };
  registry.set(id, p);
  return p;
}
const headOf = (id) => registry.get(id).__q[".fpanel-head"];

const addCls = (c, n) => (c + " " + n).trim().split(/\s+/).filter(Boolean).join(" ").replace(/^ /, "");
const delCls = (c, n) => c.split(/\s+/).filter((x) => x && x !== n).join(" ");

/** 合成事件并同步派发给该元素注册的处理器 */
function fire(el, type, patch) {
  const ev = Object.assign({
    type, target: el, currentTarget: el, preventDefault: noop,
    ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    button: 0, pointerId: 1, clientX: 0, clientY: 0,
    key: "", code: "", deltaMode: 0, deltaX: 0, deltaY: 0, deltaZ: 0,
  }, patch);
  ev.__stopped = false;
  ev.stopPropagation = () => { ev.__stopped = true; };
  let thrown = null;
  for (const fn of (el.__h[type] || [])) {
    try { fn(ev); } catch (err) { thrown = err; break; }
  }
  if (thrown) throw thrown;
  return ev;
}

const docHandlers = {};
const winHandlers = {};
const sandbox = {
  console, setTimeout, clearTimeout,
  requestAnimationFrame: (f) => setTimeout(f, 0),
  addEventListener: (t, fn) => { (winHandlers[t] = winHandlers[t] || []).push(fn); },
  removeEventListener: noop,
  devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
  document: {
    body: stubEl("body"),
    getElementById: (id) => {
      if (!registry.has(id)) registry.set(id, stubEl());
      return registry.get(id);
    },
    createElement: (t) => stubEl(t),
    querySelectorAll: () => [],
    addEventListener: (t, fn) => {
      (docHandlers[t] = docHandlers[t] || []).push(fn);
      if (t === "DOMContentLoaded") domReady.push(fn);
    },
    removeEventListener: noop,
  },
  Image: function () {
    const self = this;
    this.naturalWidth = 100;
    this.naturalHeight = 50;
    Object.defineProperty(this, "src", {
      set() { setTimeout(() => self.onload && self.onload(), 0); },
      configurable: true,
    });
  },
  URL: { createObjectURL: () => "blob:x", revokeObjectURL: noop },
  ResizeObserver: function () { this.observe = noop; },
  DOMMatrix: function () { this.scale = () => this; },
};
sandbox.globalThis = sandbox;
const fireDoc = (t, p) => {
  const ev = Object.assign({
    type: t, target: sandbox.document.body, currentTarget: sandbox.document,
    preventDefault: noop, ctrlKey: false, metaKey: false, shiftKey: false,
    altKey: false, key: "", code: "",
  }, p);
  ev.__stopped = false;
  ev.stopPropagation = () => { ev.__stopped = true; };
  for (const fn of (docHandlers[t] || [])) fn(ev);
  return ev;
};

const ctx = vm.createContext(sandbox);
vm.runInContext("var window = this; window.window = window;", ctx);

/* ---------------- 断言工具 ---------------- */
let fail = 0;
const report = (name, ok, extra) => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra && !ok ? "  " + extra : ""}`);
};
const near = (a, b, t) => Math.abs(a - b) <= (t || 1e-6) * Math.max(1, Math.abs(b));

/* ---------------- 加载与启动 ---------------- */
for (const rel of files) {
  try {
    vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), ctx, { filename: rel });
  } catch (err) {
    fail++;
    console.log(`LOAD FAIL  ${rel}: ${err.message}`);
  }
}
report(`全部模块加载 (${files.length} 个)`, fail === 0);

// 浮窗在真实 DOM 里默认隐藏；提前注册，init() 才能拿到带标题条的替身
panelStub("crop-panel");
panelStub("rotate-panel");

for (const fn of domReady) {
  try { fn(); } catch (err) { fail++; console.log("BOOT FAIL " + err.stack); }
}
report("boot() 无异常", domReady.length === 1);

/* ---------------- API 与跨模块引用 ---------------- */
const IT = vm.runInContext("IT", ctx);
const api = {};
for (const k of Object.keys(IT)) if (IT[k] && typeof IT[k] === "object") api[k] = Object.keys(IT[k]);

let dangling = 0;
for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  let m;
  const re = /\bIT\.([a-z]+)\.([A-Za-z_$][\w$]*)/g;
  while ((m = re.exec(src))) {
    const [full, mod, fn] = m;
    if (!api[mod]) { dangling++; console.log(`  悬空 ${rel}: ${full}（模块缺失）`); continue; }
    if (!api[mod].includes(fn)) { dangling++; console.log(`  悬空 ${rel}: ${full}`); }
  }
}
report("跨模块引用全部可解析", dangling === 0);

/* ---------------- HTML 契约 ---------------- */
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
let contract = 0;
for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
  if (!fs.existsSync(path.join(root, m[1]))) { contract++; console.log(`  缺少脚本 ${m[1]}`); }
}
for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) {
  if (!fs.existsSync(path.join(root, m[1]))) { contract++; console.log(`  缺少样式 ${m[1]}`); }
}
const wantedIds = new Set();
for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  for (const m of src.matchAll(/getElementById\(\s*["']([^"']+)["']/g)) wantedIds.add(m[1]);
}
for (const id of wantedIds) {
  if (!new RegExp(`id="${id}"`).test(html)) { contract++; console.log(`  DOM 缺少 id="${id}"`); }
}
report(`HTML 契约（脚本 + ${wantedIds.size} 个 id）`, contract === 0);
if (process.env.VERBOSE_API) {
  console.log("API 面:");
  for (const [k, v] of Object.entries(api)) console.log(`  IT.${k} → ${v.join(", ")}`);
}

/* ---------------- config 映射 ---------------- */
const c = IT.config, u = IT.util;
report("slider 端点 = MIN/MAX",
  near(c.sliderToScale(0), c.MIN_SCALE) && near(c.sliderToScale(c.SLIDER_MAX), c.MAX_SCALE));
report("100% 落在 slider 中部", Math.abs(c.scaleToSlider(1) - 624) <= 1);
report("就近吸附 100%", c.snapScale(1.002) === 1 && c.snapScale(1.02) !== 1);
report("就近吸附 200%", c.snapScale(2.001) === 2);
report("clamp 边界", c.clampScale(1e-9) === c.MIN_SCALE && c.clampScale(1e9) === c.MAX_SCALE);
report("文本格式", u.percent(1) === "100" && u.percent(0.3333) === "33"
  && u.bytes(1536) === "1.50 KB" && u.ext("a.b.PNG") === "png");

/* ---------------- 视口几何 ---------------- */
const V = IT.viewport, St = IT.state;
const $ = (id) => registry.get(id);

report("空文档渲染不抛异常", (() => { try { V.render(); return true; } catch (e) { return false; } })());

(async function () {
  /* --- 载入一张 100×50 的图 --- */
  await IT.fileio.loadFile({ name: "sample.png", type: "image/png", size: 4096 }, null);
  report("loadFile 写入 doc", !!St.doc.image && St.doc.width === 100 && St.doc.height === 50);
  report("载入后自动适应窗口", near(St.view.scale, V.fitScale(), 1e-9) && V.isFitted());

  const back = V.screenToImage(V.imageToScreen(37, 21).x, V.imageToScreen(37, 21).y);
  report("image↔screen 往返", near(back.x, 37) && near(back.y, 21));

  {
    const sx = 400, sy = 300, p = V.screenToImage(sx, sy);
    V.zoomAt(2, sx, sy);
    const q = V.imageToScreen(p.x, p.y);
    report("缩放锚点不漂移 (2×)", near(q.x, sx) && near(q.y, sy));
  }

  const x0 = St.view.x, y0 = St.view.y;
  V.pan(17, -9);
  report("平移增量", near(St.view.x, x0 + 17, 1e-9) && near(St.view.y, y0 - 9, 1e-9));

  V.zoom100();
  report("1:1 → scale=1", St.view.scale === 1);
  V.setScale(c.sliderToScale(c.scaleToSlider(1)));
  report("slider→scale 回 100%", St.view.scale === 1);
  V.setScale(1e-6); report("下越界夹到 MIN", St.view.scale === c.MIN_SCALE);
  V.setScale(1e6); report("上越界夹到 MAX", St.view.scale === c.MAX_SCALE);

  /* --- 状态栏文本 --- */
  report("B1 尺寸文本", /100\s*×\s*50 px/.test($("lbl-size").textContent));
  St.cursor = { x: 4.2, y: 9.9, inside: true };
  IT.bus.emit("cursor:move", St.cursor);
  report("B2 坐标 1-based", $("lbl-coord").textContent === "x: 5\u00a0\u00a0y: 10");
  St.cursor = { x: null, y: null, inside: false };
  IT.bus.emit("cursor:move", St.cursor);
  report("B2 出界回落", $("lbl-coord").textContent.includes("—"));
  report("B3 slider 与 scale 同步", +$("zoom-slider").value === c.scaleToSlider(St.view.scale)
    && parseFloat($("zoom-value").value) === parseFloat(u.percent(St.view.scale)));

  /* ================= 交互接线 ================= */
  const cv = $("viewport");
  report("呈现区已绑定交互", Object.keys(cv.__h).length >= 5);

  fire($("btn-fit"), "click", {});
  report("「适应」按钮 → 适应缩放", V.isFitted());

  fire($("btn-100"), "click", {});
  report("「1:1」按钮 → 100%", St.view.scale === 1);

  fire($("zoom-out"), "click", {});
  report("「−」按钮缩小", St.view.scale < 1);
  const zoomedOut = St.view.scale;
  fire($("zoom-in"), "click", {});
  report("「+」按钮放大", St.view.scale > zoomedOut);

  // slider 拖动
  $("zoom-slider").value = String(c.scaleToSlider(0.5));
  fire($("zoom-slider"), "input", {});
  report("slider input → scale 0.5", St.view.scale === 0.5);

  // 数字输入
  $("zoom-value").value = "250";
  fire($("zoom-value"), "change", {});
  report("百分比输入 → scale 2.5", St.view.scale === 2.5);

  // 滚轮：放大，且以指针为锚点
  V.fit();
  {
    const before = V.screenToImage(400, 300);
    fire(cv, "wheel", { deltaY: -100, clientX: 400, clientY: 300 });
    const after = V.imageToScreen(before.x, before.y);
    report("滚轮放大且锚点不漂", St.view.scale > V.fitScale() && near(after.x, 400) && near(after.y, 300));

    const s1 = St.view.scale;
    fire(cv, "wheel", { deltaY: 100, clientX: 400, clientY: 300 });
    report("滚轮反向缩小", St.view.scale < s1);

    const x1 = St.view.x;
    fire(cv, "wheel", { deltaY: 0, deltaX: 40, shiftKey: true, clientX: 400, clientY: 300 });
    report("Shift+滚轮 水平平移", St.view.x !== x1);
  }

  // 拖动平移
  {
    const x1 = St.view.x, y1 = St.view.y;
    fire(cv, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    fire(cv, "pointermove", { button: 0, clientX: 160, clientY: 130 });
    fire(cv, "pointerup", { pointerId: 1 });
    report("拖动平移视图", near(St.view.x, x1 + 60, 1e-9) && near(St.view.y, y1 + 30, 1e-9));
    report("拖动后恢复指针", !cv.classList.contains("dragging"));

    fire(cv, "pointermove", { clientX: 600, clientY: 400 });
    report("移动更新 B2 坐标", $("lbl-coord").textContent.match(/x:\s*\d+/) !== null);
  }

  // 双击在 适应 / 100% 之间切换
  V.fit();
  fire(cv, "dblclick", {});
  const dbl1 = St.view.scale;
  report("双击 → 100%", dbl1 === 1);
  fire(cv, "dblclick", {});
  report("双击回到适应", V.isFitted());

  // 快捷键
  fireDoc("keydown", { ctrlKey: true, key: "1", code: "Digit1", target: sandbox.document.body });
  report("Ctrl+1 → 100%", St.view.scale === 1);
  fireDoc("keydown", { ctrlKey: true, key: "0", code: "Digit0", target: sandbox.document.body });
  report("Ctrl+0 → 适应", V.isFitted());
  fireDoc("keydown", { ctrlKey: true, key: "=", code: "EqualEqual", target: sandbox.document.body });
  report("Ctrl+= 放大", St.view.scale > V.fitScale());

  // 空格：进入抓手模式
  fireDoc("keydown", { code: "Space", target: sandbox.document.body });
  report("Space 进入平移模式", cv.classList.contains("pan-mode"));
  fireDoc("keyup", { code: "Space", target: sandbox.document.body });
  report("松开 Space 退出", !cv.classList.contains("pan-mode"));

  // 焦点在 % 输入框时，快捷键应在输入框处被拦下，不外泄
  V.zoom100();
  $("zoom-value").tagName = "INPUT";   // 替身元素要像真的 <input>
  const sBefore = St.view.scale;
  const inField = fire($("zoom-value"), "keydown", { ctrlKey: true, key: "0", code: "Digit0" });
  report("输入框内快捷键就地停止", inField.__stopped && St.view.scale === sBefore);

  // 工具栏：未实现分组给出提示，打开按钮存在
  report("工具栏按钮按文档态启用", $("btn-save").disabled === false && $("btn-saveas").disabled === false);
  fire($("btn-open"), "click", {});

  // 保存：无写句柄时降级为下载
  St.handle = null;
  const dl = await IT.fileio.saveAs();
  report("另存为在无句柄时仍完成", dl === true);

  /* ================= M2：裁剪 ================= */
  {
    const C = IT.crop, panel = $("crop-panel");
    const num = (id) => Number($(id).value);
    report("M2 模块已注册", !!C && !!IT.transform && !!IT.panels);

    fire($("btn-crop"), "click", {});
    report("「裁剪」→ 预备裁剪模式 + 面板浮出", C.isActive() && panel.hidden === false);
    const full = C.getRect();
    report("默认选区 = 整幅", full.x === 0 && full.y === 0 && full.w === 100 && full.h === 50);
    report("面板初始回填", num("crop-left") === 0 && num("crop-top") === 0
      && num("crop-right") === 0 && num("crop-bottom") === 0
      && num("crop-w") === 100 && num("crop-h") === 50);

    // 边距 → 尺寸
    $("crop-left").value = "10";
    fire($("crop-left"), "input", {});
    report("左 = 10 ⇒ 宽自动变 90", C.getRect().x === 10 && num("crop-w") === 90);

    // 尺寸 → 边距
    $("crop-w").value = "50";
    fire($("crop-w"), "input", {});
    report("宽 = 50 ⇒ 右边距自动变 40", C.getRect().w === 50 && num("crop-right") === 40);

    // 对侧固定
    $("crop-right").value = "20";
    fire($("crop-right"), "input", {});
    report("右 = 20 ⇒ 左不变 / 宽 70", num("crop-left") === 10 && C.getRect().w === 70);

    $("crop-top").value = "5";
    fire($("crop-top"), "input", {});
    report("上 = 5 ⇒ 高 45", C.getRect().y === 5 && num("crop-h") === 45);
    $("crop-bottom").value = "15";
    fire($("crop-bottom"), "input", {});
    report("下 = 15 ⇒ 高 30", num("crop-h") === 30);

    $("crop-left").value = "9999";
    fire($("crop-left"), "input", {});
    const clamped = C.getRect();
    report("边距越界被夹住", clamped.w >= 1 && clamped.x >= 0
      && clamped.x + clamped.w <= St.doc.width);

    C.setRect(10, 5, 70, 30);
    report("面板按 Enter 提交", (() => {
      $("crop-w").value = "60";
      fire($("crop-w"), "keydown", { key: "Enter" });
      return C.getRect().w === 60;
    })());
    C.setRect(10, 5, 70, 30);

    /* --- 选区拖动 --- */
    // 默认整幅时，第一下拖动应该是「框选」，而不是把整幅挪开
    C.setRect(0, 0, St.doc.width, St.doc.height);
    fire(cv, "pointerdown", { button: 0, clientX: 380, clientY: 300 });
    fire(cv, "pointermove", { button: 0, clientX: 420, clientY: 320 });
    fire(cv, "pointerup", { pointerId: 1 });
    const first = C.getRect();
    report("整幅态第一下拖动 = 框选而非整幅平移",
      first.x === 30 && first.y === 25 && first.w === 40 && first.h === 20);

    C.setRect(0, 0, 20, 10);
    const vx = St.view.x, vy = St.view.y;
    fire(cv, "pointerdown", { button: 0, clientX: 380, clientY: 300 });
    fire(cv, "pointermove", { button: 0, clientX: 420, clientY: 320 });
    fire(cv, "pointerup", { pointerId: 1 });
    const sel = C.getRect();
    report("空白处拖出新选区", sel.x === 30 && sel.y === 25 && sel.w === 40 && sel.h === 20);
    report("裁剪时拖动不平移视图", St.view.x === vx && St.view.y === vy);
    report("拖动中选区实时写回面板", num("crop-w") === 40 && num("crop-right") === 30);

    fire(cv, "pointerdown", { button: 0, clientX: 400, clientY: 310 });
    fire(cv, "pointermove", { button: 0, clientX: 410, clientY: 305 });
    fire(cv, "pointerup", { pointerId: 1 });
    const mv = C.getRect();
    report("选区内拖动 = 整体移动", mv.x === 40 && mv.y === 20 && mv.w === 40 && mv.h === 20);

    C.setRect(20, 10, 40, 20);
    fire(cv, "pointerdown", { button: 0, clientX: 410, clientY: 305 });
    fire(cv, "pointermove", { button: 0, clientX: 430, clientY: 325 });
    fire(cv, "pointerup", { pointerId: 1 });
    const rs = C.getRect();
    report("拖动角柄 = 只动该角", rs.x === 20 && rs.y === 10 && rs.w === 60 && rs.h === 40);

    // 键盘微调
    fireDoc("keydown", { key: "ArrowRight", target: sandbox.document.body });
    report("→ 微调 1px", C.getRect().x === 21);
    fireDoc("keydown", { key: "ArrowUp", shiftKey: true, target: sandbox.document.body });
    report("Shift+↑ 微调 10px", C.getRect().y === 0);

    // 单击一下（没有真的画出框）不该把选区压成 1×1
    C.setRect(0, 0, 10, 10);
    fire(cv, "pointerdown", { button: 0, clientX: 400, clientY: 310 });
    fire(cv, "pointerup", { pointerId: 1 });
    const keep = C.getRect();
    report("单击不误缩选区", keep.w === 10 && keep.h === 10);
    fireDoc("keydown", { key: "Escape", target: sandbox.document.body });
    report("Esc 取消裁剪并收起面板", !C.isActive() && $("crop-panel").hidden === true);

    fireDoc("keydown", { key: "c", target: sandbox.document.body });
    report("C 键进入裁剪", C.isActive());
    fire($("crop-cancel"), "click", {});
    report("「取消裁剪」退出", !C.isActive() && $("crop-panel").hidden === true);

    fire($("btn-crop"), "click", {});
    fire($("crop-close"), "click", {});
    report("✕ 收起浮窗同样退出模式并取消高亮",
      !C.isActive() && $("crop-panel").hidden === true
      && !$("btn-crop").classList.contains("active"));

    /* --- 实施裁剪 --- */
    fire($("btn-crop"), "click", {});
    C.setRect(10, 10, 40, 20);
    const sBefore = St.view.scale, xBefore = St.view.x;
    fire($("crop-apply"), "click", {});
    report("实施裁剪 → 新图 40×20", St.doc.width === 40 && St.doc.height === 20);
    report("裁剪后标记未保存", St.doc.dirty === true && St.doc.source === null);
    report("裁剪不重置缩放", St.view.scale === sBefore);
    report("裁剪后视图跟着位移", Math.abs(St.view.x - (xBefore - 10 * sBefore)) < 1e-9);
    report("B1 同步新尺寸", /40\s*×\s*20 px/.test($("lbl-size").textContent));
    report("裁剪完成后面板收起", $("crop-panel").hidden === true);
    report("工具栏出现未保存标记", $("doc-name").classList.contains("dirty"));
  }

  /* ================= M2：旋转 / 镜像 ================= */
  {
    const panel = $("rotate-panel");
    const w0 = St.doc.width, h0 = St.doc.height;
    fire($("btn-rotate"), "click", {});
    report("「旋转」显示面板", panel.hidden === false
      && $("btn-rotate").classList.contains("active"));
    fire($("btn-rotate"), "click", {});
    report("再点一次隐藏面板", panel.hidden === true
      && !$("btn-rotate").classList.contains("active"));
    fire($("btn-rotate"), "click", {});

    const cBefore = V.imageToScreen(St.doc.width / 2, St.doc.height / 2);
    fire($("rot-cw"), "click", {});
    report("顺时针 90° 交换宽高", St.doc.width === h0 && St.doc.height === w0);
    const cAfter = V.imageToScreen(St.doc.width / 2, St.doc.height / 2);
    report("旋转后视觉中心不动", near(cAfter.x, cBefore.x, 1e-6) && near(cAfter.y, cBefore.y, 1e-6));
    report("B1 同步旋转后尺寸", /20\s*×\s*40 px/.test($("lbl-size").textContent));

    fire($("mir-h"), "click", {});
    report("水平镜像不改尺寸", St.doc.width === h0 && St.doc.height === w0);
    fire($("mir-v"), "click", {});
    report("垂直镜像不改尺寸", St.doc.width === h0 && St.doc.height === w0);
    fire($("rot-ccw"), "click", {});
    report("逆时针 90° 还原尺寸", St.doc.width === w0 && St.doc.height === h0);

    fireDoc("keydown", { key: "Escape", target: sandbox.document.body });
    report("Esc 收起旋转面板", $("rotate-panel").hidden === true);
    fire($("btn-rotate"), "click", {});
    fire($("rotate-close"), "click", {});
    report("✕ 关闭面板同时撤掉按钮高亮",
      $("rotate-panel").hidden === true && !$("btn-rotate").classList.contains("active"));
    fireDoc("keydown", { key: "c", target: sandbox.document.body });
    report("裁剪模式下旋转会夹紧选区", (() => {
      IT.crop.enter();
      IT.crop.setRect(0, 0, 500, 500);
      IT.transform.rotate(90);
      const r = IT.crop.getRect();
      IT.crop.exit(true);
      return r.x + r.w <= St.doc.width && r.y + r.h <= St.doc.height;
    })());

    // 浮窗拖动
    const head = headOf("rotate-panel");
    fire(head, "pointerdown", { pointerId: 2, clientX: 200, clientY: 100 });
    fire(head, "pointermove", { pointerId: 2, clientX: 230, clientY: 140 });
    fire(head, "pointerup", { pointerId: 2 });
    report("浮窗可用标题条拖动", /px$/.test($("rotate-panel").style.left || "")
      && $("rotate-panel").classList.contains("moving") === false);
  }

  // 空文档
  St.clearDoc();
  report("清空文档", !St.doc.image && V.isFitted());
  report("工具栏回到禁用态", $("btn-save").disabled === true && $("btn-saveas").disabled === true);
  report("清空后渲染不抛异常", (() => { try { V.render(); return true; } catch (e) { return false; } })());
})().catch((err) => {
  fail++;
  console.log("BEHAVIOR FAIL " + (err && err.stack ? err.stack : err));
}).then(() => {
  console.log(fail ? `\n共 ${fail} 项失败` : "\n全部通过");
  process.exit(fail ? 1 : 0);
});
