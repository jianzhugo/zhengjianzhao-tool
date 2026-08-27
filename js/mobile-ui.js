'use strict';
// 证件照工具 - 移动端 UI 初始化、步骤导航与覆盖逻辑

// 注意：不要在移动端使用 q8 量化模型 —— RMBG-1.4 的 q8 版本在人脸区域
// 会产生大量错误的半透明 alpha 值，导致 unmixBg 把人脸涂抹成色块。
// 因此移动端与桌面端统一使用 fp16（88MB），保证抠图质量。
// 如果下载速度确实有压力，可临时改为 ["q8", "fp16"] 做测试。

if (isMobileEnv) {
  // --- 修改 loadPhotoFile 以更新移动端 UI ---
  loadPhotoFile = function(file) {
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
      // 更新桌面端按钮
      if ($("btnAI")) $("btnAI").disabled = false;
      if ($("btnCropOnly")) $("btnCropOnly").disabled = false;
      if ($("btnExport")) $("btnExport").disabled = true;
      if ($("btnExportPrint")) $("btnExportPrint").disabled = true;
      if ($("dzSub")) $("dzSub").textContent = `已选择：${file.name}（${img.naturalWidth}×${img.naturalHeight}px）`;
      // 更新移动端按钮
      const mBtnAI = $("mobileBtnAI");
      const mBtnCrop = $("mobileBtnCropOnly");
      const mBtnExp = $("mobileBtnExport");
      const mLoaded = $("mdzLoaded");
      if (mBtnAI) mBtnAI.disabled = false;
      if (mBtnCrop) mBtnCrop.disabled = false;
      if (mBtnExp) mBtnExp.disabled = true;
      const mBtnPrint = $("mobileBtnPrintToggle");
      if (mBtnPrint) mBtnPrint.disabled = true;
      if (mLoaded) { mLoaded.classList.remove("hidden"); mLoaded.textContent = `${file.name}（${img.naturalWidth}×${img.naturalHeight}px）`; }
      setStatus(`已加载照片：${file.name}\n点击「一键 AI 生成」或「仅裁剪排版」。`);
      computeBase();
      render();
      if (typeof refreshBatch === "function") refreshBatch();
    };
    img.onerror = () => setStatus("图片加载失败，请换一张试试。", true);
    img.src = url;
  };

  // --- 修改 runAI 以更新移动端按钮 ---
  runAI = async function() {
    if (!state.srcImg || state.aiBusy) return;
    state.aiBusy = true;
    const mBtnAI = $("mobileBtnAI");
    if (mBtnAI) mBtnAI.disabled = true;
    const dBtnAI = $("btnAI");
    if (dBtnAI) dBtnAI.disabled = true;
    try {
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
      if (!state.keepBg) {
        setStatus("正在 AI 抠图去背景（首次需下载模型，请稍候）…");
        const seg = await segmentImage(state.srcImg);
        state.cutImg = seg.cut;
        state.personTop = seg.personTopSrc;
        state.personBounds = seg.personBounds;
      } else {
        state.cutImg = null;
        state.personTop = null;
        state.personBounds = null;
      }
      computeBase();
      state.resultReady = true;
      render();
      if (typeof refreshBatch === "function") refreshBatch();
      if ($("btnExport")) $("btnExport").disabled = false;
      if ($("mobileBtnExport")) $("mobileBtnExport").disabled = false;
      syncMobilePrintBtn();
      setStatus("生成完成！可用第 4 步继续微调，第 6 步导出。");
      // 移动端自动跳转到导出步骤
      if (isMobileEnv) goToStep(6);
    } catch (e) {
      console.error(e);
      const msg = (e && e.message) || String(e);
      const b = detectBrowser();
      const isNet = /fetch|network|网络/i.test(msg);
      const browserHint = b.restricted
        ? `\n检测到${b.name}，可能不支持 AI 模型所需的 ES Module 动态导入或 WebAssembly。请换用 Chrome / Edge / Safari 浏览器打开本页面。`
        : (isNet
          ? "\n这是网络问题：AI 模型需要从网上下载。请确认已联网，建议用 Edge/Chrome/Safari 打开，公司/校园网可能拦截了模型下载，可换手机热点重试。"
          : "");
      setStatus("AI 处理失败：" + msg + browserHint + "\n也可勾选「保留原背景」后用「仅裁剪排版」（不需要联网）。", true);
    } finally {
      state.aiBusy = false;
      if (mBtnAI) mBtnAI.disabled = false;
      if (dBtnAI) dBtnAI.disabled = false;
    }
  };

  // --- 修改仅裁剪排版 ---
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
    if ($("btnExport")) $("btnExport").disabled = false;
    if ($("mobileBtnExport")) $("mobileBtnExport").disabled = false;
    syncMobilePrintBtn();
    setStatus("已按居中裁剪排版。可手动微调位置后导出。");
    if (isMobileEnv) goToStep(6);
  };
} // end if(isMobileEnv) - AI 参数优化

// ==================== 移动端 UI 初始化（始终运行） ====================
// 移动端 UI 初始化始终运行（元素在 DOM 中存在，通过 CSS 控制显示/隐藏）。
// 移动端 UI 行为通过 isMobileEnv 判断，AI 质量参数与桌面端完全一致。

// 步骤导航
  const TOTAL_STEPS = 7;
  const stepDots = $("stepDots");
  const stepViews = document.querySelectorAll(".mobile-step-view");
  const prevBtn = $("prevStep");
  const nextBtn = $("nextStep");
  const stepNumEl = $("mhStepNum");

  function updateDots() {
    stepDots.innerHTML = "";
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const dot = document.createElement("div");
      dot.className = "mf-dot" + (i === state.mobileStep ? " active" : (i < state.mobileStep ? " done" : ""));
      stepDots.appendChild(dot);
    }
  }

  function goToStep(n) {
    state.mobileStep = Math.max(1, Math.min(TOTAL_STEPS, n));
    stepViews.forEach(v => v.classList.toggle("active", +v.dataset.step === state.mobileStep));
    updateDots();
    stepNumEl.textContent = state.mobileStep;
    prevBtn.disabled = state.mobileStep === 1;
    // 步骤 5（AI 生成）的下一步在未生成时禁用
    if (state.mobileStep === 5 && !state.resultReady) {
      nextBtn.textContent = "下一步";
      nextBtn.disabled = true;
    } else if (state.mobileStep === 6) {
      nextBtn.textContent = "批量导出";
      nextBtn.disabled = false;
    } else if (state.mobileStep === TOTAL_STEPS) {
      nextBtn.textContent = "完成";
      nextBtn.disabled = false;
    } else {
      nextBtn.textContent = "下一步";
      nextBtn.disabled = false;
    }
    // 滚动到顶部
    $("mobileBody").scrollTop = 0;
  }

  prevBtn.onclick = () => goToStep(state.mobileStep - 1);
  nextBtn.onclick = () => {
    if (state.mobileStep === TOTAL_STEPS) {
      goToStep(1);
    } else {
      goToStep(state.mobileStep + 1);
    }
  };

  // 返回按钮（回到步骤 1）
  $("mhBack").onclick = () => goToStep(1);

  // 初始化步骤指示器
  updateDots();
  goToStep(1);

  // ==================== 移动端上传 ====================
  $("mobileDropzone").onclick = () => $("mobileFileInput").click();
  $("mobileFileInput").onchange = e => {
    const file = e.target.files[0];
    if (file) { loadPhotoFile(file); goToStep(2); }
  };

  // ==================== 移动端规格初始化 ====================
  const mSpecGrid = $("mobileSpecGrid");
  SIZE_PRESETS.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "mobile-spec-card" + (i === 0 ? " active" : "");
    const sizeText = p.name === "自定义" ? "自由宽高" : `${p.w}×${p.h}px`;
    card.innerHTML = `<div class="msc-name"><span class="msc-dot" style="background:${p.dot}"></span>${p.name}</div>
      <div class="msc-size">${sizeText}</div>
      <div class="msc-desc">${p.desc}</div>`;
    card.onclick = () => {
      mSpecGrid.querySelectorAll(".mobile-spec-card").forEach(s => s.classList.remove("active"));
      card.classList.add("active");
      state.presetIdx = i;
      if (p.name !== "自定义") { $("mobileCustomW").value = p.w; $("mobileCustomH").value = p.h; }
      $("mobileCustomRow").style.display = p.name === "自定义" ? "flex" : "none";
      updateMobileMmInfo();
      computeBase();
      render();
      // 自动跳转到下一步
      goToStep(3);
    };
    mSpecGrid.appendChild(card);
  });

  function updateMobileMmInfo() {
    const s = currentSize();
    $("mobileMmInfo").textContent = `像素 ${s.w}×${s.h} ｜ 约 ${s.wmm.toFixed(1)}×${s.hmm.toFixed(1)} mm（按300DPI）`;
  }
  $("mobileCustomW").oninput = $("mobileCustomH").oninput = () => { updateMobileMmInfo(); computeBase(); render(); };
  $("mobileCustomW").value = SIZE_PRESETS[0].w;
  $("mobileCustomH").value = SIZE_PRESETS[0].h;
  updateMobileMmInfo();

  // ==================== 移动端底色 ====================
  const mSwatchBox = $("mobileSwatches");
  BG_COLORS.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "mobile-swatch" + (i === 0 ? " active" : "");
    d.style.background = c.value;
    d.title = c.name;
    d.innerHTML = `<span>${c.name}</span>`;
    d.onclick = () => {
      mSwatchBox.querySelectorAll(".mobile-swatch").forEach(s => s.classList.remove("active"));
      d.classList.add("active");
      setMobileBgColor(c.value);
    };
    mSwatchBox.appendChild(d);
  });

  function setMobileBgColor(value) {
    state.bgColor = value;
    state.keepBg = false;
    $("mobileKeepBg").checked = false;
    $("mobileCustomColor").value = value;
    $("mobileHexColor").value = value.toUpperCase();
    render();
    // 同步桌面端
    if ($("keepBg")) $("keepBg").checked = false;
    if ($("customColor")) $("customColor").value = value;
    if ($("hexColor")) $("hexColor").value = value.toUpperCase();
    const swatches = document.querySelectorAll(".swatch");
    swatches.forEach(s => s.classList.remove("active"));
    if (state.srcImg && !state.cutImg && !state.keepBg && !state.aiBusy) {
      setStatus("换底色需要先抠图：请点击「一键 AI 生成」。\n只需抠图一次，之后切换底色都是即时生效。");
    }
  }

  $("mobileCustomColor").oninput = e => {
    mSwatchBox.querySelectorAll(".mobile-swatch").forEach(s => s.classList.remove("active"));
    setMobileBgColor(e.target.value);
  };
  $("mobileHexColor").onchange = e => {
    let v = e.target.value.trim();
    if (!v.startsWith("#")) v = "#" + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      mSwatchBox.querySelectorAll(".mobile-swatch").forEach(s => s.classList.remove("active"));
      setMobileBgColor(v);
    } else {
      e.target.value = state.bgColor.toUpperCase();
    }
  };
  $("mobileKeepBg").onchange = e => { state.keepBg = e.target.checked; render(); };

  // ==================== 移动端 AI 按钮 ====================
  $("mobileBtnAI").onclick = () => runAI();
  $("mobileBtnCropOnly").onclick = () => {
    if (!state.srcImg) return;
    state.cutImg = null;
    state.faceBox = null;
    state.personTop = null;
    state.personBounds = null;
    computeBase();
    state.resultReady = true;
    render();
    if (typeof refreshBatch === "function") refreshBatch();
    if ($("btnExport")) $("btnExport").disabled = false;
    if ($("mobileBtnExport")) $("mobileBtnExport").disabled = false;
    syncMobilePrintBtn();
    setStatus("已按居中裁剪排版。可手动微调位置后导出。");
    goToStep(6);
  };

  // ==================== 移动端微调滑条 ====================
  ["mobileAdjZoom", "mobileAdjX", "mobileAdjY"].forEach(id => {
    $(id).oninput = () => {
      $("mobileAdjZoomVal").textContent = $("mobileAdjZoom").value + "%";
      $("mobileAdjXVal").textContent = $("mobileAdjX").value;
      $("mobileAdjYVal").textContent = $("mobileAdjY").value;
      // 同步桌面端滑条
      const map = { mobileAdjZoom: "adjZoom", mobileAdjX: "adjX", mobileAdjY: "adjY" };
      const desktopId = map[id];
      if ($(desktopId)) $(desktopId).value = $(id).value;
      render();
    };
  });
  // 移动端美化控件（同步到桌面端控件，JS 函数统一读桌面端）
  $("mobileBeautyOn").onchange = () => {
    if ($("beautyOn")) $("beautyOn").checked = $("mobileBeautyOn").checked;
    render();
  };
  $("mobileBeautyStrength").oninput = () => {
    const v = $("mobileBeautyStrength").value;
    $("mobileBeautyStrengthVal").textContent = v + "%";
    if ($("beautyStrength")) $("beautyStrength").value = v;
    if ($("beautyStrengthVal")) $("beautyStrengthVal").textContent = v + "%";
    render();
  };
  // 移动端成品/原图切换
  document.querySelectorAll('.mobile-seg-row .seg-btn').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.mobile-seg-row .seg-btn').forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      const showRaw = b.dataset.mseg === "before";
      const mc = $("mobileCanvas"), mraw = $("mobileRawCanvas"), mrawWrap = $("mobileRawWrap");
      const mcWrap = mc ? mc.parentElement : null;
      if (mcWrap) mcWrap.classList.toggle("hidden", showRaw);
      if (mrawWrap) mrawWrap.classList.toggle("hidden", !showRaw);
    };
  });
  $("mobileResetAdj").onclick = () => {
    ["mobileAdjZoom", "mobileAdjX", "mobileAdjY"].forEach(id => {
      const defaults = { mobileAdjZoom: 100, mobileAdjX: 0, mobileAdjY: 0 };
      $(id).value = defaults[id];
    });
    // 同步桌面端
    if ($("adjZoom")) { $("adjZoom").value = 100; $("adjX").value = 0; $("adjY").value = 0; }
    $("mobileAdjZoomVal").textContent = "100%";
    $("mobileAdjXVal").textContent = "0";
    $("mobileAdjYVal").textContent = "0";
    render();
  };

  // ==================== 移动端导出 ====================
  $("mobileBtnExport").onclick = async () => {
    const s = currentSize();
    const format = $("mobileExportFormat").value;
    const maxKB = +$("mobileMaxKB").value || 0;
    const { blob, note } = await canvasToBlobLimit($("mobileCanvas"), format, maxKB);
    downloadBlob(blob, `证件照_${s.name}_${s.w}x${s.h}.${format === "png" ? "png" : "jpg"}`);
    $("mobileExportInfo").textContent = `已导出 ${s.w}×${s.h}px ${note}`;
  };

  // ==================== 移动端排版打印 ====================
  // 排版打印按钮启用/禁用跟随 resultReady
  function syncMobilePrintBtn() {
    const btn = $("mobileBtnPrintToggle");
    if (btn) btn.disabled = !state.resultReady;
  }
  // 排版区域展开/折叠
  if ($("mobileBtnPrintToggle")) $("mobileBtnPrintToggle").onclick = () => {
    const sec = $("mobilePrintSection");
    const btn = $("mobileBtnPrintToggle");
    if (!sec || !btn) return;
    const isHidden = sec.style.display === "none";
    sec.style.display = isHidden ? "block" : "none";
    btn.textContent = isHidden ? "收起排版" : "排版打印";
  };
  // 生成排版
  if ($("mobileBtnLayout")) $("mobileBtnLayout").onclick = () => {
    if (!state.resultReady) { alert("请先生成证件照。"); return; }
    const s = currentSize();
    const paper = PAPERS[$("mobilePaperSize").value] || PAPERS["A4"];
    let pwmm = paper.wmm, phmm = paper.hmm;
    if ($("mobilePaperOrient").value === "landscape") [pwmm, phmm] = [phmm, pwmm];
    let fwmm = s.wmm, fhmm = s.hmm;
    if ($("mobilePhotoOrient").value === "landscape") [fwmm, fhmm] = [fhmm, fwmm];
    const paperW = mm2px(pwmm), paperH = mm2px(phmm);
    const photoW = mm2px(fwmm), photoH = mm2px(fhmm);
    const gap = mm2px(2), margin = mm2px(3);
    const cols = Math.floor((paperW - margin * 2 + gap) / (photoW + gap));
    const rows = Math.floor((paperH - margin * 2 + gap) / (photoH + gap));
    if (cols < 1 || rows < 1) {
      $("mobilePrintInfo").textContent = `当前相纸放不下 ${fwmm.toFixed(0)}×${fhmm.toFixed(0)}mm 的照片，请换更大的相纸或调整方向。`;
      $("mobileBtnExportPrint").disabled = true;
      return;
    }
    const total = cols * rows;
    const canvas = $("mobilePrintCanvas");
    canvas.width = paperW; canvas.height = paperH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, paperW, paperH);
    const usedW = cols * photoW + (cols - 1) * gap;
    const usedH = rows * photoH + (rows - 1) * gap;
    const startX = (paperW - usedW) / 2, startY = (paperH - usedH) / 2;
    const src = $("mobileCanvas");
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = startX + c * (photoW + gap), py = startY + r * (photoH + gap);
        if ($("mobilePhotoOrient").value === "landscape") {
          ctx.save();
          ctx.translate(px + photoW / 2, py + photoH / 2);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(src, -photoH / 2, -photoW / 2, photoH, photoW);
          ctx.restore();
        } else {
          ctx.drawImage(src, px, py, photoW, photoH);
        }
        ctx.strokeStyle = "#CCCCCC";
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, photoW, photoH);
      }
    }
    $("mobilePrintInfo").textContent = `${$("mobilePaperSize").selectedOptions[0].text} ｜ 每张 ${fwmm.toFixed(1)}×${fhmm.toFixed(1)}mm ｜ 共 ${total} 张（${cols}×${rows}）｜ ${paperW}×${paperH}px @300DPI`;
    $("mobileBtnExportPrint").disabled = false;
  };
  // 导出排版图
  if ($("mobileBtnExportPrint")) $("mobileBtnExportPrint").onclick = () => {
    $("mobilePrintCanvas").toBlob(b => {
      downloadBlob(b, `相纸排版_${$("mobilePaperSize").value}_${$("mobilePaperOrient").value === "landscape" ? "横" : "竖"}.jpg`);
    }, "image/jpeg", 0.95);
  };

  // ==================== 移动端批量导出 ====================
  function initMobileBatchChips() {
    const sc = $("mobileBatchSpecChips");
    if (sc) SIZE_PRESETS.forEach((p, i) => {
      if (p.name === "自定义") return;
      const el = document.createElement("span");
      el.className = "chip"; el.textContent = p.name;
      if (batchSel.specs.has(i)) el.classList.add("active");
      el.onclick = () => { toggleSet(batchSel.specs, i, el); refreshBatch(); };
      sc.appendChild(el);
    });
    const bc = $("mobileBatchBgChips");
    if (bc) BG_COLORS.forEach((c_, i) => {
      const el = document.createElement("span");
      el.className = "chip"; el.textContent = c_.name;
      if (batchSel.bgs.has(i)) el.classList.add("active");
      el.onclick = () => { toggleSet(batchSel.bgs, i, el); refreshBatch(); };
      bc.appendChild(el);
    });
  }
  initMobileBatchChips();
  if ($("mobileBtnBatchExport")) $("mobileBtnBatchExport").onclick = () => runBatchExport(true);
  if ($("mobileBtnBatchZip")) $("mobileBtnBatchZip").onclick = () => runBatchExport(false);

  // 步骤 5（AI 生成）状态检查：未生成时禁用下一步
  // 定期检查状态，确保步骤 5 的下一步按钮状态正确
  setInterval(() => {
    if (state.mobileStep === 5) {
      nextBtn.disabled = !state.resultReady;
    }
  }, 500);
