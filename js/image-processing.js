'use strict';
// 证件照工具 - 图像处理：遮罩清理、反混色、颜色净化、美化滤镜

// 遮罩清理管线（双阈值磁滞重建 + 闭运算填孔 + 羽化）：
// 强阈值(a>140)取"确定是人"的核心并保留其最大连通块；弱阈值(a>40)区域仅当与核心相连才保留。
// 外围斑块与人体核心不相连 → 被清除；不确定但与身体相连的部位（浅色头发/脸边缘）→ 保留。
function cleanMask(px, rw, rh) {
  const MW = 512, MH = Math.max(1, Math.round(MW * rh / rw));
  const strong = new Uint8Array(MW * MH);
  const weak = new Uint8Array(MW * MH);
  for (let my = 0; my < MH; my++)
    for (let mx = 0; mx < MW; mx++) {
      const sx = Math.min(rw - 1, (mx * rw / MW) | 0);
      const sy = Math.min(rh - 1, (my * rh / MH) | 0);
      const a = px[(sy * rw + sx) * 4 + 3];
      strong[my * MW + mx] = a > 140 ? 1 : 0;
      weak[my * MW + mx] = a > 40 ? 1 : 0;
    }
  // 1) 强核心的最大连通块
  const label = new Int32Array(MW * MH).fill(-1);
  const area = [];
  let nComp = 0;
  const stack = [];
  for (let i = 0; i < MW * MH; i++) {
    if (!strong[i] || label[i] >= 0) continue;
    const id = nComp++;
    let cnt = 0;
    stack.length = 0; stack.push(i); label[i] = id;
    while (stack.length) {
      const cur = stack.pop(); cnt++;
      const cx0 = cur % MW, cy0 = (cur / MW) | 0;
      if (cx0 > 0 && strong[cur - 1] && label[cur - 1] < 0) { label[cur - 1] = id; stack.push(cur - 1); }
      if (cx0 < MW - 1 && strong[cur + 1] && label[cur + 1] < 0) { label[cur + 1] = id; stack.push(cur + 1); }
      if (cy0 > 0 && strong[cur - MW] && label[cur - MW] < 0) { label[cur - MW] = id; stack.push(cur - MW); }
      if (cy0 < MH - 1 && strong[cur + MW] && label[cur + MW] < 0) { label[cur + MW] = id; stack.push(cur + MW); }
    }
    area[id] = cnt;
  }
  if (!nComp) return; // 没有可靠核心就不动遮罩
  let best = 0;
  for (let i = 1; i < nComp; i++) if (area[i] > area[best]) best = i;
  // 2) 从核心出发在弱遮罩上生长（磁滞重建）
  let m = new Uint8Array(MW * MH);
  stack.length = 0;
  for (let i = 0; i < MW * MH; i++) if (label[i] === best) { m[i] = 1; stack.push(i); }
  while (stack.length) {
    const cur = stack.pop();
    const cx0 = cur % MW, cy0 = (cur / MW) | 0;
    if (cx0 > 0 && weak[cur - 1] && !m[cur - 1]) { m[cur - 1] = 1; stack.push(cur - 1); }
    if (cx0 < MW - 1 && weak[cur + 1] && !m[cur + 1]) { m[cur + 1] = 1; stack.push(cur + 1); }
    if (cy0 > 0 && weak[cur - MW] && !m[cur - MW]) { m[cur - MW] = 1; stack.push(cur - MW); }
    if (cy0 < MH - 1 && weak[cur + MW] && !m[cur + MW]) { m[cur + MW] = 1; stack.push(cur + MW); }
  }
  // 3) 闭运算：填平人物内部小孔（脸/衣服上的色点）
  const dilate = (src, r) => {
    let t = new Uint8Array(MW * MH), out = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++)
      for (let x = 0; x < MW; x++) {
        let v = 0;
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < MW && src[y * MW + xx]) { v = 1; break; } }
        t[y * MW + x] = v;
      }
    for (let y = 0; y < MH; y++)
      for (let x = 0; x < MW; x++) {
        let v = 0;
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < MH && t[yy * MW + x]) { v = 1; break; } }
        out[y * MW + x] = v;
      }
    return out;
  };
  const erode = (src, r) => {
    let t = new Uint8Array(MW * MH), out = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++)
      for (let x = 0; x < MW; x++) {
        let v = 1;
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= MW || !src[y * MW + xx]) { v = 0; break; } }
        t[y * MW + x] = v;
      }
    for (let y = 0; y < MH; y++)
      for (let x = 0; x < MW; x++) {
        let v = 1;
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= MH || !t[yy * MW + x]) { v = 0; break; } }
        out[y * MW + x] = v;
      }
    return out;
  };
  m = erode(dilate(m, 3), 3);  // 闭运算填小孔（保留细丝：细线经膨胀-腐蚀后仍在）
  // 羽化：512 网格画到 canvas 再双线性放大回原尺寸，边缘自然过渡
  const mc = document.createElement("canvas"); mc.width = MW; mc.height = MH;
  const mctx = mc.getContext("2d");
  const mimg = mctx.createImageData(MW, MH);
  for (let i = 0; i < MW * MH; i++) {
    const v = m[i] * 255;
    mimg.data[i * 4] = v; mimg.data[i * 4 + 1] = v; mimg.data[i * 4 + 2] = v; mimg.data[i * 4 + 3] = 255;
  }
  mctx.putImageData(mimg, 0, 0);
  const big = document.createElement("canvas"); big.width = rw; big.height = rh;
  const bctx = big.getContext("2d");
  bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = "high";
  bctx.drawImage(mc, 0, 0, rw, rh);
  const soft = bctx.getImageData(0, 0, rw, rh).data;
  // 最终 alpha = min(模型原始软 alpha, 清理后遮罩)
  // 保留碎发的半透明细节（不丢发丝），被清理区域归零；仅压掉 alpha<25 的极弱丝
  for (let i = 0; i < rw * rh; i++) {
    const a = Math.min(px[i * 4 + 3], soft[i * 4]);
    px[i * 4 + 3] = a < 25 ? 0 : a;
  }
}

// 估计原背景色：取四边边缘带的每通道中位数
function estimateBg(px, rw, rh) {
  const samples = [[], [], []];
  const band = Math.max(2, Math.round(Math.min(rw, rh) * 0.03));
  for (let y = 0; y < rh; y += 2)
    for (let x = 0; x < rw; x += 2) {
      if (x < band || x >= rw - band || y < band || y >= rh - band) {
        const i = (y * rw + x) * 4;
        samples[0].push(px[i]); samples[1].push(px[i+1]); samples[2].push(px[i+2]);
      }
    }
  const med = arr => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
  return [med(samples[0]), med(samples[1]), med(samples[2])];
}

// 反混色（un-premultiply）：半透明像素的颜色 = (观测色 - (1-a)·背景色) / a
// 还原碎发/边缘的真实颜色，去掉"罩了一层原背景色"的白纱感
function unmixBg(px, rw, rh, bg) {
  for (let i = 0; i < rw * rh; i++) {
    const a = px[i * 4 + 3];
    if (a > 10 && a < 245) {
      const inv = 255 - a;
      for (let ch = 0; ch < 3; ch++) {
        const idx = i * 4 + ch;
        px[idx] = Math.max(0, Math.min(255, Math.round((px[idx] * 255 - inv * bg[ch]) / a)));
      }
    }
  }
}

// 颜色净化：边缘带像素的 RGB 从人物深内部逐层借色。
// 种子 = 完全不透明 且 颜色与原背景明显不同（白渣点颜色接近背景色 → 不当种子，会被借色修正）
function decontaminate(px, rw, rh, bg) {
  const colorDist = i => Math.abs(px[i*4] - bg[0]) + Math.abs(px[i*4+1] - bg[1]) + Math.abs(px[i*4+2] - bg[2]);
  const interior = new Uint8Array(rw * rh);
  for (let y = 1; y < rh - 1; y++)
    for (let x = 1; x < rw - 1; x++) {
      const i = y * rw + x;
      if (px[i*4+3] === 255 && colorDist(i) > 50
          && px[(i-1)*4+3] === 255 && px[(i+1)*4+3] === 255
          && px[(i-rw)*4+3] === 255 && px[(i+rw)*4+3] === 255)
        interior[i] = 1;
    }
  for (let iter = 0; iter < 20; iter++) {  // 20 轮 ≈ 覆盖 20px 边缘带（发际碎发较长）
    let changed = 0;
    for (let y = 1; y < rh - 1; y++)
      for (let x = 1; x < rw - 1; x++) {
        const i = y * rw + x;
        if (interior[i]) continue;
        if (interior[i-1] || interior[i+1] || interior[i-rw] || interior[i+rw]) {
          const j = interior[i-1] ? i-1 : interior[i+1] ? i+1 : interior[i-rw] ? i-rw : i+rw;
          px[i*4] = px[j*4]; px[i*4+1] = px[j*4+1]; px[i*4+2] = px[j*4+2];
          interior[i] = 1; changed++;
        }
      }
    if (!changed) break;
  }
}

// ==================== 轻度去瑕疵美化（本地、克制、不联网） ====================
// 分离式盒式模糊（预乘保留），返回 Float32 数组 [r*a,g*a,b*a,a]（a 为 0..1）
function boxBlurPm(px, w, h, r) {
  const n = w * h;
  const tmp = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3] / 255;
    tmp[i * 4] = px[i * 4] * a; tmp[i * 4 + 1] = px[i * 4 + 1] * a;
    tmp[i * 4 + 2] = px[i * 4 + 2] * a; tmp[i * 4 + 3] = a;
  }
  const out1 = new Float32Array(n * 4);
  for (let y = 0; y < h; y++) {
    const yb = y * w, dw = 2 * r + 1;
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let x = -r; x <= r; x++) {
      const xx = Math.max(0, Math.min(w - 1, x)), i = (yb + xx) * 4;
      sr += tmp[i]; sg += tmp[i + 1]; sb += tmp[i + 2]; sa += tmp[i + 3];
    }
    for (let x = 0; x < w; x++) {
      const i = (yb + x) * 4;
      out1[i] = sr / dw; out1[i + 1] = sg / dw; out1[i + 2] = sb / dw; out1[i + 3] = sa / dw;
      const xo = Math.max(0, Math.min(w - 1, x - r)), xi = Math.max(0, Math.min(w - 1, x + r + 1));
      const oi = (yb + xo) * 4, ii = (yb + xi) * 4;
      sr += tmp[ii] - tmp[oi]; sg += tmp[ii + 1] - tmp[oi + 1]; sb += tmp[ii + 2] - tmp[oi + 2]; sa += tmp[ii + 3] - tmp[oi + 3];
    }
  }
  const out2 = new Float32Array(n * 4);
  for (let x = 0; x < w; x++) {
    const dw = 2 * r + 1;
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let y = -r; y <= r; y++) {
      const yy = Math.max(0, Math.min(h - 1, y)), i = (yy * w + x) * 4;
      sr += out1[i]; sg += out1[i + 1]; sb += out1[i + 2]; sa += out1[i + 3];
    }
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      out2[i] = sr / dw; out2[i + 1] = sg / dw; out2[i + 2] = sb / dw; out2[i + 3] = sa / dw;
      const yo = Math.max(0, Math.min(h - 1, y - r)), yi = Math.max(0, Math.min(h - 1, y + r + 1));
      const oi = (yo * w + x) * 4, ii = (yi * w + x) * 4;
      sr += out1[ii] - out1[oi]; sg += out1[ii + 1] - out1[oi + 1]; sb += out1[ii + 2] - out1[oi + 2]; sa += out1[ii + 3] - out1[oi + 3];
    }
  }
  return out2;
}

let __beautyCache = { img: null, strength: -1, cut: null };

// 对抠图后的透明底人物做轻度美化：柔和提亮 + 皮肤轻磨皮 + 轻锐化 + 眼周提亮。
// 全部按 strength(0~1) 缩放且克制；边缘（低 alpha 发丝）按透明度加权避免假面。
function beautifyCut(img, strength) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const px = id.data;
  let hasPerson = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 10) { hasPerson = true; break; }
  if (!hasPerson || strength <= 0) return c;
  const blur = boxBlurPm(px, w, h, 2);
  const fb = state.faceBox;
  const eyeCY = fb ? (fb.y + fb.h * 0.38) : h * 0.35;
  const eyeDX = fb ? fb.w * 0.22 : w * 0.18;
  const eyeRX = fb ? fb.w * 0.16 : w * 0.15;
  const eyeRY = fb ? fb.h * 0.10 : h * 0.06;
  const centers = fb
    ? [{ x: fb.x + fb.w * 0.32, y: eyeCY }, { x: fb.x + fb.w * 0.68, y: eyeCY }]
    : [{ x: w / 2 - eyeDX, y: eyeCY }, { x: w / 2 + eyeDX, y: eyeCY }];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = px[i + 3];
      if (a <= 10) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const ba = blur[i + 3];
      let br = px[i], gg = px[i + 1], bb = px[i + 2];
      if (ba > 1e-4) { br = blur[i] / ba; gg = blur[i + 1] / ba; bb = blur[i + 2] / ba; }
      const dr = r - br, dg = g - gg, db = b - bb;
      const skin = (r > g && g >= b - 8 && (r - b) > 16 && r > 100 && r < 235 && a > 128) ? 1 : 0;
      const egW = a / 255;
      const arm = Math.min(1, strength) * (0.35 + 0.65 * egW);
      let eye = 0;
      for (const ct of centers) {
        const ex = (x - ct.x) / eyeRX, ey = (y - ct.y) / eyeRY;
        if (ex * ex + ey * ey < 1) { eye = 1; break; }
      }
      const brightLift = 0.05 * arm;
      const sharpen = 0.5 * arm;
      const smooth = skin ? 0.45 * arm : 0;
      const eyeLift = eye ? (0.5 * arm) : 0;
      let nr = r * (1 + brightLift) + dr * sharpen + (br - r) * smooth + eyeLift * 14;
      let ng = g * (1 + brightLift) + dg * sharpen + (gg - g) * smooth + eyeLift * 14;
      let nb = b * (1 + brightLift) + db * sharpen + (bb - b) * smooth + eyeLift * 6;
      px[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      px[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      px[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

function ensureBeautyCut() {
  if (!state.cutImg) return state.cutImg;
  const key = Math.round(+$("beautyStrength").value / 20); // 每 20 档重算一次，避免拖动卡顿
  if (__beautyCache.img === state.cutImg && __beautyCache.strength === key) return __beautyCache.cut;
  const cut = beautifyCut(state.cutImg, +$("beautyStrength").value / 100);
  __beautyCache = { img: state.cutImg, strength: key, cut };
  return cut;
}
