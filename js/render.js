'use strict';
// 证件照工具 - 渲染合成：定位、绘制、前后对比滑杆

// ==================== 合成渲染 ====================
function computeBaseFor(W, H) {
  if (!state.srcImg) return null;
  const imgW = state.srcImg.naturalWidth, imgH = state.srcImg.naturalHeight;
  const cover = Math.max(W / imgW, H / imgH); // 铺满画布所需最小缩放
  if (!state.faceBox) {
    const scale = cover;                  // 覆盖式居中
    return { scale, x: (W - imgW * scale) / 2, y: (H - imgH * scale) / 2 };
  }
  const f = state.faceBox;
  // 头顶：优先用抠图轮廓的真实顶（含发型，最准），否则按检测框估算
  // 健壮性：轮廓顶必须位于检测框中点以上，否则视为无效（遮罩异常时回退估算值）
  let crownY = f.y - f.h * 0.6;
  if (state.personTop != null && state.personTop < f.y + f.h * 0.5) crownY = state.personTop;
  const chinY = f.y + f.h;
  const headH = Math.max(1, chinY - crownY);
  // 头（含发型）占照片高约 62% 定主缩放（证件照规范）
  let scale = (H * 0.62) / headH;
  const faceCx = f.x + f.w / 2;
  // 保证水平方向人物铺满画布（左右不露底色）
  const needX = Math.max(W / (2 * Math.max(1, faceCx)),
                         W / (2 * Math.max(1, imgW - faceCx)));
  scale = Math.max(scale, cover, needX);
  // 人物本体铺满：保证抠出的「人物本体」左右都盖到画布边，避免一侧露底色
  if (state.personBounds) {
    const pb = state.personBounds;
    if (pb.x1 > pb.x0 && faceCx > pb.x0 && faceCx < pb.x1) {
      const scBody = Math.max(
        W / (2 * Math.max(1, faceCx - pb.x0)),
        W / (2 * Math.max(1, pb.x1 - faceCx))
      );
      scale = Math.max(scale, scBody);
    }
  }
  const x = W / 2 - faceCx * scale;      // 人脸始终水平居中
  let y = H * 0.07 - crownY * scale;     // 头顶留约 7% 上边距
  // 垂直兜底：底部盖不住画布则整体下移
  y = Math.max(y, H - imgH * scale);
  return { scale, x, y };
}
function computeBase() {
  const s = currentSize();
  state.base = computeBaseFor(s.w, s.h) || state.base;
}

// 渲染最终证件照到新 canvas（供主预览 / 批量导出 / 前后对比复用）
function renderToCanvas(spec, opts = {}) {
  const W = spec.w, H = spec.h;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const keepBg = opts.keepBg != null ? opts.keepBg : state.keepBg;
  const bg = opts.bg != null ? opts.bg : state.bgColor;
  const zoom = opts.zoom != null ? opts.zoom : (+$("adjZoom").value / 100);
  const dx = opts.dx != null ? opts.dx : (+$("adjX").value / 100 * W / 2);
  const dy = opts.dy != null ? opts.dy : (+$("adjY").value / 100 * H / 2);
  const beauty = opts.beauty != null
    ? opts.beauty
    : ($("beautyOn").checked && state.cutImg && !keepBg && +$("beautyStrength").value > 0);
  ctx.fillStyle = keepBg ? "#FFFFFF" : bg;
  ctx.fillRect(0, 0, W, H);
  if (!state.srcImg) return canvas;
  const base = opts.base || state.base;
  if (!base) return canvas;
  const imgW = state.srcImg.naturalWidth, imgH = state.srcImg.naturalHeight;
  const person = beauty ? ensureBeautyCut() : (state.cutImg || state.srcImg);
  const sc = base.scale * zoom;
  const dw = imgW * sc, dh = imgH * sc;
  const cx = base.x + imgW * base.scale / 2;
  const cy = base.y + imgH * base.scale / 2;
  ctx.drawImage(person, cx - dw / 2 + dx, cy - dh / 2 + dy, dw, dh);
  return canvas;
}

// 渲染"原图"版本到目标 canvas：原图按当前规格覆盖居中（保留原背景），用于「原图/对比」视图
function renderRawTo(spec, target) {
  if (!target) return;
  target.width = spec.w; target.height = spec.h;
  const ctx = target.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, spec.w, spec.h);
  if (!state.srcImg) return;
  const cover = Math.max(spec.w / state.srcImg.naturalWidth, spec.h / state.srcImg.naturalHeight);
  const dw = state.srcImg.naturalWidth * cover, dh = state.srcImg.naturalHeight * cover;
  ctx.drawImage(state.srcImg, (spec.w - dw) / 2, (spec.h - dh) / 2, dw, dh);
}

// ==================== 前后对比滑杆 ====================
// 对比滑杆位置（默认居中）
let curComparePos = 0.5;
function setComparePos(x) {
  const p = Math.max(0, Math.min(1, x));
  curComparePos = p;
  const line = $("baLine"), handle = $("baHandle"), after = $("baAfter");
  if (line) line.style.left = (p * 100) + "%";
  if (handle) handle.style.left = (p * 100) + "%";
  if (after) after.clipPath = "inset(0 0 0 " + (p * 100) + "%)";
}

function render() {
  const s = currentSize();
  const finalC = renderToCanvas(s, {});
  // 桌面端：成品画布
  const rc = $("resultCanvas");
  if (rc) { rc.width = finalC.width; rc.height = finalC.height; rc.getContext("2d").drawImage(finalC, 0, 0); }
  // 桌面端：原图 & 前后对比视图同步刷新
  renderRawTo(s, $("rawCanvas"));
  renderRawTo(s, $("baBefore"));
  const ac = $("baAfter");
  if (ac) { ac.width = finalC.width; ac.height = finalC.height; ac.getContext("2d").drawImage(finalC, 0, 0); }
  setComparePos(curComparePos);
  // 移动端：成品 + 原图画布
  const mc = $("mobileCanvas");
  if (mc) { mc.width = finalC.width; mc.height = finalC.height; mc.getContext("2d").drawImage(finalC, 0, 0); }
  renderRawTo(s, $("mobileRawCanvas"));
}
