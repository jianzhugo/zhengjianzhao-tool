'use strict';
// 证件照工具 - AI 人脸检测与抠图模型

// ==================== 浏览器检测 ====================
function detectBrowser() {
  const ua = navigator.userAgent;
  // 夸克、UC、QQ浏览器、360浏览器、搜狗浏览器等国产浏览器内核可能限制 ES Module 动态导入或 WASM
  const restricted = [
    { pattern: /Quark|quark/i, name: "夸克浏览器" },
    { pattern: /UCBrowser|UC\s/i, name: "UC浏览器" },
    { pattern: /QQBrowser|QQ/i, name: "QQ浏览器" },
    { pattern: /360SE|360EE|Qihoo/i, name: "360浏览器" },
    { pattern: /SE\s|Sogou/i, name: "搜狗浏览器" },
    { pattern: /LieBao/i, name: "猎豹浏览器" },
    { pattern: /Baidu/i, name: "百度浏览器" },
    { pattern: /MicroMessenger/i, name: "微信内置浏览器" },
  ];
  for (const b of restricted) {
    if (b.pattern.test(ua)) return { name: b.name, restricted: true };
  }
  return { name: null, restricted: false };
}

async function ensureFaceModel() {
  if (state.faceModelReady) return true;
  if (typeof faceapi === "undefined") return false;
  // 人脸检测模型权重：多 CDN 源容错，任一源不可达自动换下一个
  const WEIGHT_URLS = [
    "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights",
    "https://fastly.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights",
    "https://gcore.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights",
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights",
  ];
  for (const url of WEIGHT_URLS) {
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(url);
      state.faceModelReady = true;
      return true;
    } catch (e) {
      console.warn("人脸模型加载失败，换源重试", url, e);
    }
  }
  console.warn("人脸模型所有源均加载失败，将跳过人脸检测（不影响 AI 抠图）");
  return false;
}

let __segPipe = null;

// transformers.js AI 运行时：多 CDN 源容错（jsdelivr 被部分网络拦截时自动换源）
// 优先用 ES Module 动态 import()，失败后回退 script 标签加载 UMD 构建（兼容夸克/UC等）。
// npmmirror（淘宝）为国内高可达源，放在最前，适配手机流量/校园网等 jsdelivr 不可达的环境。
async function importTransformers() {
  // 方式1：ES Module 动态 import()
  const esmUrls = [
    "https://registry.npmmirror.com/@huggingface/transformers/3.8.1/files/dist/transformers.js",
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1",
    "https://fastly.jsdelivr.net/npm/@huggingface/transformers@3.8.1",
    "https://gcore.jsdelivr.net/npm/@huggingface/transformers@3.8.1",
    "https://unpkg.com/@huggingface/transformers@3.8.1",
  ];
  let lastErr = null;
  for (const u of esmUrls) {
    try { return await import(u); } catch (e) { lastErr = e; console.warn("transformers.js ES Module 加载失败，换源重试", u, e); }
  }
  // 方式2：script 标签加载 UMD 构建（夸克/UC 等不支持动态 import() 时的 fallback）
  const umdUrls = [
    "https://registry.npmmirror.com/@huggingface/transformers/3.8.1/files/dist/transformers.min.js",
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js",
    "https://fastly.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js",
    "https://gcore.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js",
    "https://unpkg.com/@huggingface/transformers@3.8.1/dist/transformers.min.js",
  ];
  console.warn("ES Module 动态加载全部失败，尝试 script 标签 fallback …");
  for (const u of umdUrls) {
    try {
      await loadScript(u);
      if (window.transformers) {
        console.info("transformers.js UMD 加载成功", u);
        return window.transformers;
      }
    } catch (e) { lastErr = e; console.warn("UMD 加载失败，换源重试", u, e); }
  }
  // 两种方式均失败，给出浏览器检测提示
  const b = detectBrowser();
  const hint = b.restricted
    ? `检测到${b.name}，可能不支持 AI 模型所需的 ES Module 动态导入或 WebAssembly。请换用 Chrome / Edge / Safari 浏览器。`
    : "AI 组件加载失败，请检查网络或换用 Chrome / Edge / Safari 浏览器。";
  throw new Error(hint);
}

// 通过 script 标签加载 UMD 构建
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script 加载失败: " + src));
    document.head.appendChild(s);
  });
}

async function segmentImage(img) {
  // transformers.js 多 CDN 容错加载（wasm 路径自动指向所用源的 dist）
  const T = await importTransformers();
  T.env.allowLocalModels = false;
  if (!__segPipe) {
    const progress = p => {
      if (p.status === "progress" && p.total)
        setStatus(`正在下载抠图模型… ${Math.round((p.loaded || 0) / p.total * 100)}%`);
      else if (p.status === "done")
        setStatus("模型下载完成，正在编译初始化（首次需 1~3 分钟，请耐心等待）…");
      else if (p.status === "initiate")
        setStatus("正在加载抠图模型…");
    };
    // RMBG-1.4 模型权重走 remoteHost（hf-mirror 国内可达，失败自动换 huggingface.co）；
    // fp16（约88MB）遮罩质量优于 q8 量化版，每个镜像内失败自动回退 q8。
    // 注意：ONNX 运行时的 WASM 二进制默认从 JS 包所在 CDN 的 dist 目录拉取，那个源可能
    // 在国产浏览器/部分手机网络下被卡住，即使模型权重能下载也会报 fetch/network 错，
    // 因此这里把 wasmPaths 也纳入多源容错，三者（模型源 × dtype × wasm源）逐个组合重试。
    const HOSTS = ["https://hf-mirror.com", "https://huggingface.co"];
    const DTYPES = ["fp16", "q8"];
    const WASM_BASES = [
      "https://registry.npmmirror.com/@huggingface/transformers/3.8.1/files/dist/",
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/",
      "https://fastly.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/",
      "https://gcore.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/",
      "https://unpkg.com/@huggingface/transformers@3.8.1/dist/",
    ];
    let lastErr = null;
    outer: for (const host of HOSTS) {
      T.env.remoteHost = host;
      for (const dtype of DTYPES) {
        for (const wasmBase of WASM_BASES) {
          try {
            if (T.env.backends?.onnx?.wasm) T.env.backends.onnx.wasm.wasmPaths = wasmBase;
            __segPipe = await T.pipeline("background-removal", "briaai/RMBG-1.4", { dtype, progress_callback: progress });
            console.info(`抠图模型加载成功：${dtype} @ ${host} | wasm: ${wasmBase}，${state.isMobile ? "移动端" : "桌面端"}`);
            break outer;
          } catch (e) {
            lastErr = e;
            console.warn(`抠图模型加载失败（${host} / ${dtype} / ${wasmBase}），换源重试`, e);
          }
        }
      }
    }
    if (!__segPipe) throw lastErr || new Error("抠图模型加载失败");
  }
  setStatus("正在 AI 抠图去背景（约 10~30 秒）…");
  // 超大照片先降采样到最长边 1600 再推理，明显提速；证件照输出远低于该尺寸，画质无损感
  const MAX_SEG = 1600;
  let sw = img.naturalWidth, sh = img.naturalHeight;
  if (Math.max(sw, sh) > MAX_SEG) {
    const k = MAX_SEG / Math.max(sw, sh);
    sw = Math.round(sw * k); sh = Math.round(sh * k);
  }
  const c = document.createElement("canvas");
  c.width = sw; c.height = sh;
  const ctx0 = c.getContext("2d");
  ctx0.drawImage(img, 0, 0, sw, sh);
  // 从原图边缘带估计背景色（用于反混色和污染点识别）
  const srcPx = ctx0.getImageData(0, 0, sw, sh).data;
  const bg = estimateBg(srcPx, sw, sh);
  const out = await __segPipe(c.toDataURL("image/png"));
  const rgba = out[0]; // RawImage，RGBA，与送入尺寸相同
  const px = new Uint8ClampedArray(rgba.data);
  const rw = rgba.width, rh = rgba.height;
  cleanMask(px, rw, rh);
  unmixBg(px, rw, rh, bg);        // 半透明像素按原背景色反混色，还原碎发真实颜色
  decontaminate(px, rw, rh, bg);  // 边缘带+污染点从人物内部借色
  const cc = document.createElement("canvas");
  cc.width = rw; cc.height = rh;
  cc.getContext("2d").putImageData(new ImageData(px, rw, rh), 0, 0);
  // 从 alpha 轮廓找人物真实头顶行（含发型）与人物本体的左右边界，
  // 换算回原图坐标系，用于精准定位、并让「人物本体」铺满画布（避免一侧露底色）
  let topRow = -1;
  let minX = -1, maxX = -1;
  for (let y = 0; y < rgba.height; y++) {
    for (let x = 0; x < rgba.width; x++) {
      if (px[(y * rgba.width + x) * 4 + 3] > 30) {
        if (topRow < 0) topRow = y;
        if (minX < 0 || x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  const cut = new Image();
  await new Promise((res, rej) => { cut.onload = res; cut.onerror = rej; cut.src = cc.toDataURL("image/png"); });
  const k = img.naturalHeight / rgba.height; // 换算系数（抠图与源图同比例）
  return {
    cut,
    personTopSrc: topRow >= 0 ? topRow * k : null,
    personBounds: (minX >= 0 && maxX >= 0) ? { x0: minX * k, x1: maxX * k } : null,
  };
}
