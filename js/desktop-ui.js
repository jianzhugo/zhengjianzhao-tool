'use strict';
// 证件照工具 - 桌面端 UI 初始化与事件绑定

// ==================== 规格卡片 ====================
const specGrid = $("specGrid");
SIZE_PRESETS.forEach((p, i) => {
  const card = document.createElement("div");
  card.className = "spec-card" + (i === 0 ? " active" : "");
  const sizeText = p.name === "自定义" ? "自由宽高" : `${p.w}×${p.h}px`;
  card.innerHTML = `<div class="spec-name"><span class="spec-dot" style="background:${p.dot}"></span>${p.name}</div>
    <div class="spec-size">${sizeText}</div>
    <div class="spec-desc">${p.desc}</div>`;
  card.onclick = () => {
    document.querySelectorAll(".spec-card").forEach(s => s.classList.remove("active"));
    card.classList.add("active");
    state.presetIdx = i;
    if (p.name !== "自定义") { $("customW").value = p.w; $("customH").value = p.h; }
    $("customSizeRow").style.display = p.name === "自定义" ? "flex" : "none";
    updateMmInfo();
    computeBase();
    render();
  };
  specGrid.appendChild(card);
});

// ==================== 底色色块 ====================
const swatchBox = $("swatches");
BG_COLORS.forEach((c, i) => {
  const d = document.createElement("div");
  d.className = "swatch" + (i === 0 ? " active" : "");
  d.style.background = c.value;
  d.title = c.name;
  d.innerHTML = `<span>${c.name}</span>`;
  d.onclick = () => {
    document.querySelectorAll(".swatch").forEach(s => s.classList.remove("active"));
    d.classList.add("active");
    setBgColor(c.value);
  };
  swatchBox.appendChild(d);
});
// 底色统一入口（色块/取色器/hex 共用）
function setBgColor(value) {
  state.bgColor = value;
  state.keepBg = false;
  $("keepBg").checked = false;
  $("customColor").value = value;
  $("hexColor").value = value.toUpperCase();
  render();
  hintNeedAI();
}
$("customColor").oninput = e => {
  document.querySelectorAll(".swatch").forEach(s => s.classList.remove("active"));
  setBgColor(e.target.value);
};
$("hexColor").onchange = e => {
  let v = e.target.value.trim();
  if (!v.startsWith("#")) v = "#" + v;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    document.querySelectorAll(".swatch").forEach(s => s.classList.remove("active"));
    setBgColor(v);
  } else {
    e.target.value = state.bgColor.toUpperCase();
  }
};

$("customW").oninput = $("customH").oninput = () => { updateMmInfo(); computeBase(); render(); };
$("keepBg").onchange = e => { state.keepBg = e.target.checked; render(); };
updateMmInfo();
$("customW").value = SIZE_PRESETS[0].w;
$("customH").value = SIZE_PRESETS[0].h;

// ==================== 图片加载（点击 + 拖拽） ====================
const dropzone = $("dropzone");
dropzone.onclick = () => $("fileInput").click();
dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add("dragover"); };
dropzone.ondragleave = () => dropzone.classList.remove("dragover");
dropzone.ondrop = e => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) loadPhotoFile(file);
};
$("fileInput").onchange = e => {
  const file = e.target.files[0];
  if (file) loadPhotoFile(file);
};
function loadPhotoFile(file) {
  if (!file.type.startsWith("image/")) { setStatus("请选择图片文件。", true); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.srcImg = img;
    state.cutImg = null;
    state.faceBox = null;
    state.personTop = null;
    state.personBounds = null;
    state.resultReady = false;
    $("btnAI").disabled = false;
    $("btnCropOnly").disabled = false;
    $("btnExport").disabled = true;
    $("btnExportPrint").disabled = true;
    if ($("mobileBtnExport")) $("mobileBtnExport").disabled = true;
    if ($("mobileBtnPrintToggle")) $("mobileBtnPrintToggle").disabled = true;
    $("dzSub").textContent = `已选择：${file.name}（${img.naturalWidth}×${img.naturalHeight}px）`;
    setStatus(`已加载照片：${file.name}\n点击「一键 AI 生成」或「仅裁剪排版」。`);
    computeBase();
    render();
    if (typeof refreshBatch === "function") refreshBatch();
  };
  img.onerror = () => setStatus("图片加载失败，请换一张试试。", true);
  img.src = url;
}

// ==================== 一键 AI 生成 ====================
$("btnAI").onclick = () => runAI();
async function runAI() {
  if (!state.srcImg || state.aiBusy) return;
  state.aiBusy = true;
  $("btnAI").disabled = true;
  try {
    // 1. 人脸检测
    setStatus("正在加载人脸检测模型…");
    const faceOk = await ensureFaceModel();
    if (faceOk) {
      setStatus("正在检测人脸…");
      const det = await faceapi.detectSingleFace(
        state.srcImg, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.3 })
      );
      if (det) {
        const b = det.box;
        state.faceBox = { x: b.x, y: b.y, w: b.width, h: b.height };
      } else {
        state.faceBox = null;
        console.warn("未检测到人脸，使用居中裁剪");
      }
    } else {
      state.faceBox = null;
    }

    // 2. 抠图（保留原背景则跳过）
    if (!state.keepBg) {
      setStatus("正在 AI 抠图去背景（首次需下载模型，请稍候）…");
      const seg = await segmentImage(state.srcImg);
      state.cutImg = seg.cut;
      state.personTop = seg.personTopSrc; // 人物真实头顶（原图坐标）
      state.personBounds = seg.personBounds; // 人物本体左右边界（原图坐标）
    } else {
      state.cutImg = null;
      state.personTop = null;
      state.personBounds = null;
    }

    // 3. 合成（保留用户在步骤4已调好的缩放/位置/美化参数）
    computeBase();
    state.resultReady = true;
    render();
    if (typeof refreshBatch === "function") refreshBatch();
    $("btnExport").disabled = false;
    setStatus("生成完成！可用第 4 步继续微调，第 6 步导出。\n如需打印，切换到「相纸排版打印」标签页。");
  } catch (e) {
    console.error(e);
    const msg = (e && e.message) || String(e);
    const b = detectBrowser();
    const isNet = /fetch|network|网络/i.test(msg);
    const browserHint = b.restricted
      ? `\n检测到${b.name}，可能不支持 AI 模型所需的 ES Module 动态导入或 WebAssembly。请换用 Chrome / Edge / Safari 浏览器打开本页面。`
      : (isNet
        ? "\n这是网络问题：AI 模型需要从网上下载。请确认已联网，建议用 Edge/Chrome 直接打开本文件（不要在微信里直接打开），公司/校园网可能拦截了模型下载，可换手机热点重试。"
        : "");
    setStatus("AI 处理失败：" + msg + browserHint + "\n也可勾选「保留原背景」后用「仅裁剪排版」（不需要联网）。", true);
  } finally {
    state.aiBusy = false;
    $("btnAI").disabled = false;
  }
};

// 仅裁剪排版（不用 AI）
$("btnCropOnly").onclick = () => {
  if (!state.srcImg) return;
  state.cutImg = null;
  state.faceBox = null;
  state.personTop = null;
  state.personBounds = null;
  computeBase();
  state.resultReady = true;
  render();
  if (typeof refreshBatch === "function") refreshBatch();
  $("btnExport").disabled = false;
  setStatus("已按居中裁剪排版。可手动微调位置后导出。");
};

// ==================== 微调滑条 ====================
["adjZoom", "adjX", "adjY"].forEach(id => {
  $(id).oninput = () => {
    $("adjZoomVal").textContent = $("adjZoom").value + "%";
    $("adjXVal").textContent = $("adjX").value;
    $("adjYVal").textContent = $("adjY").value;
    render();
  };
});
function resetAdjust() {
  $("adjZoom").value = 100; $("adjX").value = 0; $("adjY").value = 0;
  $("adjZoomVal").textContent = "100%"; $("adjXVal").textContent = "0"; $("adjYVal").textContent = "0";
  // 同步移动端显示值
  if ($("mobileAdjZoom")) { $("mobileAdjZoom").value = 100; $("mobileAdjX").value = 0; $("mobileAdjY").value = 0; }
  if ($("mobileAdjZoomVal")) { $("mobileAdjZoomVal").textContent = "100%"; $("mobileAdjXVal").textContent = "0"; $("mobileAdjYVal").textContent = "0"; }
}
$("btnResetAdj").onclick = () => { resetAdjust(); render(); };

// ==================== 标签页 ====================
document.querySelectorAll(".tab").forEach(t => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab-body").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    $("tab-" + t.dataset.tab).classList.add("active");
  };
});

// ==================== 美化开关 / 强度绑定 ====================
$("beautyOn").onchange = () => render();
$("beautyStrength").oninput = () => { $("beautyStrengthVal").textContent = $("beautyStrength").value + "%"; render(); };

// ==================== 预览视图切换 + 前后对比滑杆 ====================
function switchView(v) {
  const va = $("viewAfter"), vb = $("viewBefore"), vc = $("viewCompare");
  if (!va) return;
  va.style.display = v === "after" ? "flex" : "none";
  vb.style.display = v === "before" ? "flex" : "none";
  vc.style.display = v === "compare" ? "flex" : "none";
  if (v === "compare") setComparePos(curComparePos);
}
document.querySelectorAll(".seg-btn").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll(".seg-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    switchView(b.dataset.seg);
  };
});
const baWrap = $("baWrap");
function pointerToPos(e) {
  const rect = baWrap.getBoundingClientRect();
  return (e.clientX - rect.left) / rect.width;
}
if (baWrap) {
  baWrap.addEventListener("pointerdown", e => {
    window.__baDrag = true; setComparePos(pointerToPos(e));
    if (baWrap.setPointerCapture && e.pointerId != null) baWrap.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  baWrap.addEventListener("pointermove", e => { if (window.__baDrag) setComparePos(pointerToPos(e)); });
  window.addEventListener("pointerup", () => { window.__baDrag = false; });
}
