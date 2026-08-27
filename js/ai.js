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
    // —— 加载优先级 ——
    // ① ModelScope（国内，阿里达摩院官方）→ ② hf-mirror → ③ huggingface.co；
    // 每级内 fp16 优先、失败回退 q8。
    // watchdog：60 秒无进度强制换下一源（pipeline 不支持 signal，用 Promise.race 超时）。
    let lastProgress = Date.now();
    const STALL_MS = 60000;
    const progress = p => {
      lastProgress = Date.now();
      const file = p.file || p.name || "";
      if (p.status === "progress" && p.total)
        setStatus(`正在下载抠图模型… ${Math.round((p.loaded || 0) / p.total * 100)}%（${file}）`);
      else if (p.status === "done")
        setStatus(`模型文件就绪：${file}，正在编译初始化（首次需 1~3 分钟，请耐心等待）…`);
      else if (p.status === "initiate") {
        console.info("[模型加载] 开始拉取资源：", file);
        setStatus(`正在加载：${file || "抠图模型"}（若卡住将自动换源）…`);
      }
    };
    // watchdog 包装：pipeline 卡住时 reject，进入外层 catch 换源
    const withWatchdog = (dtype) => {
      let stallTimer = null;
      const raceTimeout = new Promise((_, reject) => {
        stallTimer = setInterval(() => {
          if (Date.now() - lastProgress > STALL_MS)
            reject(new Error(`加载卡住超过 ${STALL_MS / 1000} 秒（无进度）`));
        }, 5000);
      });
      const p = T.pipeline("background-removal", "briaai/RMBG-1.4", { dtype, progress_callback: progress });
      p.catch(() => {}).finally(() => clearInterval(stallTimer));
      return Promise.race([p, raceTimeout]);
    };
    const DTYPES = ["fp16", "q8"];
    const WASM_BASES = [
      "https://registry.npmmirror.com/@huggingface/transformers/3.8.1/files/dist/",
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/",
      "https://fastly.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/",
      "https://gcore.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/",
      "https://unpkg.com/@huggingface/transformers@3.8.1/dist/",
    ];
    const REMOTE_SRCS = [
      { name: "modelscope", host: "https://modelscope.cn/models", pathTemplate: "{model}/resolve/master/", probeFile: "config.json" },
      { name: "hf-mirror", host: "https://hf-mirror.com" },
      { name: "huggingface", host: "https://huggingface.co" },
    ];
    let lastErr = null;

    // fetch 硬超时 patch：任何远程请求 120s 无响应强制 abort，防止静默挂起
    const ORIG_FETCH = window.fetch.bind(window);
    const patchedFetch = (input, init = {}) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new Error("网络请求超时（120秒无响应）")), 120000);
      return ORIG_FETCH(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    };
    window.fetch = patchedFetch;
    try {
      setStatus("正在检测可用的模型源（约需几秒）…");
      const DEFAULT_TPL = T.env.remotePathTemplate;
      const usable = [];
      for (const s of REMOTE_SRCS) {
        const url = `${s.host}/briaai/RMBG-1.4/resolve/${s.pathTemplate ? "master/" : "main/"}${s.probeFile || "preprocessor_config.json"}`;
        let ok = true;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const res = await ORIG_FETCH(url, { signal: ctrl.signal, cache: "no-store" });
          clearTimeout(t);
          ok = res.ok;
        } catch (e) { ok = false; console.warn(`[源探测] ${s.host} 不可达：`, e && e.message); }
        if (ok) usable.push(s);
      }
      console.info("[源探测] 可用模型源：", usable.map(s => s.name));
      if (!usable.length)
        throw new Error("当前网络无法访问任何模型源。建议：① 切换 WiFi/手机热点；② 换 Chrome/Edge 浏览器后重试。");
      outer: for (const s of usable) {
        setStatus(`模型源：${s.name}${s !== usable[0] ? "（前一源失败）" : ""}…`);
        T.env.remoteHost = s.host;
        T.env.remotePathTemplate = s.pathTemplate || DEFAULT_TPL;
        for (const dtype of DTYPES) {
          for (const wasmBase of WASM_BASES) {
            lastProgress = Date.now();
            try {
              if (T.env.backends?.onnx?.wasm) T.env.backends.onnx.wasm.wasmPaths = wasmBase;
              console.info(`[模型加载] 尝试组合：${s.name} / ${dtype} / wasm:${wasmBase}`);
              __segPipe = await withWatchdog(dtype);
              console.info(`抠图模型加载成功：${dtype} @ ${s.name} | wasm: ${wasmBase}，${state.isMobile ? "移动端" : "桌面端"}`);
              break outer;
            } catch (e) {
              lastErr = e;
              __segPipe = null;
              console.warn(`抠图模型加载失败（${s.name} / ${dtype} / ${wasmBase}），换源重试`, e);
            }
          }
        }
      }
      T.env.remotePathTemplate = DEFAULT_TPL;
    } finally {
      window.fetch = ORIG_FETCH; // 恢复原始 fetch，避免影响后续正常请求
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
