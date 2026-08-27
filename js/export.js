'use strict';
// 证件照工具 - 导出证件照、批量打包、相纸排版

// ==================== 导出工具 ====================
function canvasToBlobLimit(canvas, format, maxKB) {
  return new Promise(resolve => {
    const mime = format === "png" ? "image/png" : "image/jpeg";
    if (format === "png" || !maxKB || maxKB <= 0) {
      canvas.toBlob(b => resolve({ blob: b, note: "" }), mime, 0.95);
      return;
    }
    let q = 0.92;
    const tryQ = () => {
      canvas.toBlob(b => {
        const kb = b.size / 1024;
        if (kb <= maxKB || q <= 0.1) {
          resolve({ blob: b, note: kb > maxKB ? `（已压到最低质量仍 ${kb.toFixed(0)}KB）` : `（质量 ${Math.round(q * 100)}%，${kb.toFixed(0)}KB）` });
        } else { q -= 0.08; tryQ(); }
      }, mime, q);
    };
    tryQ();
  });
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function toBlobPromise(canvas, mime, q) {
  return new Promise(res => canvas.toBlob(res, mime || "image/jpeg", q == null ? 0.95 : q));
}

// ==================== 桌面端：导出证件照 ====================
$("btnExport").onclick = async () => {
  const s = currentSize();
  const format = $("exportFormat").value;
  const maxKB = +$("maxKB").value || 0;
  const { blob, note } = await canvasToBlobLimit($("resultCanvas"), format, maxKB);
  downloadBlob(blob, `证件照_${s.name}_${s.w}x${s.h}.${format === "png" ? "png" : "jpg"}`);
  $("exportInfo").textContent = `已导出 ${s.w}×${s.h}px ${note}`;
};

// ==================== 桌面端：相纸排版 ====================
$("btnLayout").onclick = () => {
  if (!state.resultReady) { alert("请先在左侧第 4 步生成证件照。"); return; }
  const s = currentSize();
  const paper = PAPERS[$("paperSize").value] || PAPERS["A4"];
  let pwmm = paper.wmm, phmm = paper.hmm;
  if ($("paperOrient").value === "landscape") [pwmm, phmm] = [phmm, pwmm];
  let fwmm = s.wmm, fhmm = s.hmm;
  if ($("photoOrient").value === "landscape") [fwmm, fhmm] = [fhmm, fwmm];

  const paperW = mm2px(pwmm), paperH = mm2px(phmm);
  const photoW = mm2px(fwmm), photoH = mm2px(fhmm);
  const gap = mm2px(2), margin = mm2px(3);

  const cols = Math.floor((paperW - margin * 2 + gap) / (photoW + gap));
  const rows = Math.floor((paperH - margin * 2 + gap) / (photoH + gap));
  if (cols < 1 || rows < 1) {
    $("printInfo").textContent = `当前相纸放不下 ${fwmm.toFixed(0)}×${fhmm.toFixed(0)}mm 的照片，请换更大的相纸或调整方向。`;
    return;
  }
  const total = cols * rows;
  const canvas = $("printCanvas");
  canvas.width = paperW; canvas.height = paperH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, paperW, paperH);
  const usedW = cols * photoW + (cols - 1) * gap;
  const usedH = rows * photoH + (rows - 1) * gap;
  const startX = (paperW - usedW) / 2, startY = (paperH - usedH) / 2;
  const src = $("resultCanvas");
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = startX + c * (photoW + gap), py = startY + r * (photoH + gap);
      if ($("photoOrient").value === "landscape") {
        ctx.save();
        ctx.translate(px + photoW / 2, py + photoH / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(src, -photoH / 2, -photoW / 2, photoH, photoW);
        ctx.restore();
      } else {
        ctx.drawImage(src, px, py, photoW, photoH);
      }
      // 裁剪参考线（细灰框）
      ctx.strokeStyle = "#CCCCCC";
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, photoW, photoH);
    }
  }
  $("printInfo").textContent = `${$("paperSize").selectedOptions[0].text} ｜ 每张照片 ${fwmm.toFixed(1)}×${fhmm.toFixed(1)}mm ｜ 共 ${total} 张（${cols}列×${rows}行）｜ 输出 ${paperW}×${paperH}px @300DPI`;
  $("btnExportPrint").disabled = false;
};

$("btnExportPrint").onclick = () => {
  $("printCanvas").toBlob(b => {
    downloadBlob(b, `相纸排版_${$("paperSize").value}_${$("paperOrient").value === "landscape" ? "横" : "竖"}.jpg`);
  }, "image/jpeg", 0.95);
};

// ==================== 批量导出（多规格 × 多底色） ====================
function loadScriptBatch(urls) {
  return new Promise((res, rej) => {
    (function tryI(i) {
      if (i >= urls.length) return rej(new Error("批量打包组件加载失败"));
      const s = document.createElement("script");
      s.src = urls[i]; s.onload = () => res(); s.onerror = () => tryI(i + 1);
      document.head.appendChild(s);
    })(0);
  });
}
async function ensureJSZip() {
  if (window.JSZip) return true;
  try {
    await loadScriptBatch([
      "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
      "https://fastly.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
      "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js",
    ]);
    return !!window.JSZip;
  } catch (e) { console.warn("JSZip 加载失败，退回逐张下载", e); return false; }
}

const batchSel = { specs: new Set(), bgs: new Set() };
function toggleSet(set, i, el) {
  if (set.has(i)) { set.delete(i); el.classList.remove("active"); }
  else { set.add(i); el.classList.add("active"); }
}
function initBatchChips() {
  const sc = $("batchSpecChips");
  if (sc) SIZE_PRESETS.forEach((p, i) => {
    if (p.name === "自定义") return;
    const el = document.createElement("span");
    el.className = "chip"; el.textContent = p.name;
    if (p.name === "一寸") { el.classList.add("active"); batchSel.specs.add(i); }
    el.onclick = () => { toggleSet(batchSel.specs, i, el); refreshBatch(); };
    sc.appendChild(el);
  });
  const bc = $("batchBgChips");
  if (bc) BG_COLORS.forEach((c_, i) => {
    const el = document.createElement("span");
    el.className = "chip"; el.textContent = c_.name;
    if (c_.name === "白色") { el.classList.add("active"); batchSel.bgs.add(i); }
    el.onclick = () => { toggleSet(batchSel.bgs, i, el); refreshBatch(); };
    bc.appendChild(el);
  });
  refreshBatch();
}
function renderBatchCanvas(spec, bg) {
  const base = computeBaseFor(spec.w, spec.h);
  return renderToCanvas(spec, { bg, base, zoom: 1, dx: 0, dy: 0, beauty: false, keepBg: false });
}
// 填充单个预览网格到指定容器
function fillBatchGrid(gridEl) {
  if (!gridEl) return 0;
  gridEl.innerHTML = "";
  let n = 0;
  batchSel.specs.forEach(si => batchSel.bgs.forEach(bi => {
    n++;
    const spec = SIZE_PRESETS[si], bgc = BG_COLORS[bi];
    const c = renderBatchCanvas(spec, bgc.value);
    const cell = document.createElement("div"); cell.className = "bp";
    const cv = document.createElement("canvas"); cv.width = spec.w; cv.height = spec.h;
    cv.getContext("2d").drawImage(c, 0, 0);
    cell.appendChild(cv);
    const lbl = document.createElement("div"); lbl.className = "bp-label"; lbl.textContent = spec.name + " · " + bgc.name;
    cell.appendChild(lbl);
    gridEl.appendChild(cell);
  }));
  return n;
}
function refreshBatch() {
  const n = fillBatchGrid($("batchPreview")) + fillBatchGrid($("mobileBatchPreview"));
  const actualN = n / (($("batchPreview") ? 1 : 0) + ($("mobileBatchPreview") ? 1 : 0) || 1);
  const sumD = actualN > 0
    ? `共 ${actualN} 张（${batchSel.specs.size} 规格 × ${batchSel.bgs.size} 底色）。` + (state.srcImg ? "，可一键打包下载。" : "先加载照片，即可预览并打包。")
    : "请至少勾选一种规格与底色。";
  const sumM = actualN > 0
    ? `共 ${actualN} 张（${batchSel.specs.size} 规格 × ${batchSel.bgs.size} 底色）。` + (state.srcImg ? "，选择下方下载方式。" : "先加载照片，即可预览并下载。")
    : "请至少勾选一种规格与底色。";
  if ($("batchSum")) $("batchSum").textContent = sumD;
  if ($("mobileBatchSum")) $("mobileBatchSum").textContent = sumM;
  const exportDisabled = !(n > 0 && state.srcImg);
  if ($("btnBatchExport")) $("btnBatchExport").disabled = exportDisabled;
  if ($("mobileBtnBatchExport")) $("mobileBtnBatchExport").disabled = exportDisabled;
  if ($("mobileBtnBatchZip")) $("mobileBtnBatchZip").disabled = exportDisabled;
}
async function runBatchExport(isMobile) {
  if (!state.srcImg) { alert("请先加载照片。"); return; }
  const items = [];
  batchSel.specs.forEach(si => batchSel.bgs.forEach(bi => items.push({ src: SIZE_PRESETS[si], bg: BG_COLORS[bi] })));
  if (!items.length) { alert("请至少勾选一种规格与底色。"); return; }
  const btnD = $("btnBatchExport"), btnM = $("mobileBtnBatchExport"), btnMZip = $("mobileBtnBatchZip");
  const setBtn = (t, d) => {
    if (btnD) { btnD.textContent = t; btnD.disabled = d; }
    if (btnM) { btnM.textContent = t; btnM.disabled = d; }
    if (btnMZip) { btnMZip.textContent = t; btnMZip.disabled = d; }
  };
  setBtn("正在导出…", true);
  try {
    if (isMobile) {
      // 移动端：逐张下载图片，不需要 JSZip
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        const c = renderBatchCanvas(it.src, it.bg.value);
        downloadBlob(await toBlobPromise(c), `证件照_${it.src.name}_${it.bg.name}.jpg`);
        await new Promise(r => setTimeout(r, 600));
      }
      if ($("mobileBatchSum")) $("mobileBatchSum").textContent = `已逐张下载 ${items.length} 张照片。若浏览器拦截了批量下载，请允许本页弹出下载。`;
    } else {
      // 桌面端：ZIP 打包
      const hasZip = await ensureJSZip();
      if (hasZip) {
        const zip = new JSZip();
        items.forEach(it => {
          const c = renderBatchCanvas(it.src, it.bg.value);
          zip.file(`证件照_${it.src.name}_${it.bg.name}.jpg`, c.toDataURL("image/jpeg", 0.95).split(",")[1], { base64: true });
        });
        downloadBlob(await zip.generateAsync({ type: "blob" }), `证件照_批量_${items.length}张.zip`);
        if ($("batchSum")) $("batchSum").textContent = `已打包 ${items.length} 张（ZIP）到下载文件夹。`;
      } else {
        for (let k = 0; k < items.length; k++) {
          const it = items[k];
          const c = renderBatchCanvas(it.src, it.bg.value);
          downloadBlob(await toBlobPromise(c), `证件照_${it.src.name}_${it.bg.name}.jpg`);
          await new Promise(r => setTimeout(r, 600));
        }
        if ($("batchSum")) $("batchSum").textContent = `已按 ${items.length} 张逐个下载；若浏览器拦截了批量下载，请允许本页弹出下载。`;
      }
    }
  } catch (e) { console.error(e); alert("批量导出失败：" + (e && e.message || e)); }
  finally {
    if (btnD) { btnD.textContent = "打包下载全部（ZIP）"; btnD.disabled = false; }
    if (btnM) { btnM.textContent = "逐张下载"; btnM.disabled = false; }
    const btnMZip = $("mobileBtnBatchZip");
    if (btnMZip) { btnMZip.textContent = "打包下载(ZIP)"; btnMZip.disabled = false; }
  }
}
$("btnBatchExport").onclick = () => runBatchExport(false);

// ==================== 初始化批量 chips ====================
initBatchChips();
