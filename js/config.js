'use strict';
// 证件照工具 - 数据配置、状态、DOM 工具

// ==================== 数据定义 ====================
const SIZE_PRESETS = [
  { name: "一寸", w: 295, h: 413, wmm: 24.98, hmm: 34.97, desc: "简历/学生证常用", dot: "#438EDB" },
  { name: "二寸", w: 413, h: 579, wmm: 34.97, hmm: 49.02, desc: "毕业证/简历常用", dot: "#438EDB" },
  { name: "小一寸", w: 260, h: 378, wmm: 22.01, hmm: 32.00, desc: "驾驶证/体检表", dot: "#FFFFFF" },
  { name: "小二寸", w: 413, h: 531, wmm: 34.97, hmm: 44.96, desc: "护照/签证常用", dot: "#FFFFFF" },
  { name: "大一寸", w: 390, h: 567, wmm: 33.02, hmm: 48.01, desc: "部分考试报名", dot: "#438EDB" },
  { name: "大二寸", w: 413, h: 626, wmm: 34.97, hmm: 53.00, desc: "部分资格考试", dot: "#438EDB" },
  { name: "教师资格证", w: 295, h: 413, wmm: 24.98, hmm: 34.97, desc: "教资报名专用", dot: "#FFFFFF" },
  { name: "国家公务员考试", w: 295, h: 413, wmm: 24.98, hmm: 34.97, desc: "国考报名专用", dot: "#438EDB" },
  { name: "初级会计考试", w: 295, h: 413, wmm: 24.98, hmm: 34.97, desc: "会计资格报名", dot: "#FFFFFF" },
  { name: "英语四六级考试", w: 144, h: 192, wmm: 12.19, hmm: 16.26, desc: "四六级报名", dot: "#438EDB" },
  { name: "计算机等级考试", w: 390, h: 567, wmm: 33.02, hmm: 48.01, desc: "NCRE 报名", dot: "#FFFFFF" },
  { name: "研究生考试", w: 531, h: 709, wmm: 44.96, hmm: 60.03, desc: "考研报名", dot: "#FFFFFF" },
  { name: "社保卡", w: 358, h: 441, wmm: 30.31, hmm: 37.34, desc: "社保卡照片", dot: "#FFFFFF" },
  { name: "电子驾驶证", w: 260, h: 378, wmm: 22.01, hmm: 32.00, desc: "交管12123", dot: "#FFFFFF" },
  { name: "五寸", w: 1050, h: 1499, wmm: 88.90, hmm: 126.92, desc: "生活照打印", dot: "#FFFFFF" },
  { name: "自定义", w: 0, h: 0, wmm: 0, hmm: 0, desc: "自由设置宽高", dot: "#D3D3D3" },
];
const BG_COLORS = [
  { name: "白色", value: "#FFFFFF" },
  { name: "红色", value: "#FF0000" },
  { name: "蓝色", value: "#438EDB" },
  { name: "深蓝", value: "#2D3A8C" },
  { name: "浅灰", value: "#D3D3D3" },
];
const PAPERS = {
  "4R": { wmm: 102, hmm: 152 },
  "A6": { wmm: 105, hmm: 148 },
  "A5": { wmm: 148, hmm: 210 },
  "A4": { wmm: 210, hmm: 297 },
};
const DPI = 300;
const mm2px = mm => Math.round(mm / 25.4 * DPI);

// ==================== 状态 ====================
const state = {
  srcImg: null,        // 原始照片 Image
  cutImg: null,        // 抠图后 Image（透明底），null 表示用原图
  faceBox: null,       // {x,y,w,h} 源图像素坐标
  personTop: null,     // 人物真实头顶（源图 y 坐标，来自抠图轮廓）
  personBounds: null,  // 人物本体左右边界（源图 x 坐标，用于水平铺满）
  base: null,          // {scale, x, y} 基础摆放参数
  bgColor: "#FFFFFF",
  keepBg: false,
  faceModelReady: false,
  resultReady: false,
  mobileStep: 1,       // 移动端当前步骤 1-7
  isMobile: /Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
};

state.presetIdx = 0;

// ==================== DOM ====================
const $ = id => document.getElementById(id);
const statusEl = $("status");
const mStatusEl = $("mobileStatus");
function setStatus(msg, isErr = false) {
  if (statusEl) { statusEl.textContent = msg; statusEl.classList.toggle("err", isErr); }
  if (mStatusEl) { mStatusEl.textContent = msg; mStatusEl.classList.toggle("err", isErr); }
}

// ==================== 尺寸/提示工具 ====================
function currentSize() {
  const p = SIZE_PRESETS[state.presetIdx];
  if (p.name === "自定义") {
    const useMobile = state.isMobile && $("mobileCustomW");
    const cw = useMobile ? $("mobileCustomW") : $("customW");
    const ch = useMobile ? $("mobileCustomH") : $("customH");
    const w = Math.max(1, +(cw?.value || 295) || 295);
    const h = Math.max(1, +(ch?.value || 413) || 413);
    return { name: "自定义", w, h, wmm: w / DPI * 25.4, hmm: h / DPI * 25.4 };
  }
  return p;
}
function updateMmInfo() {
  const s = currentSize();
  $("mmInfo").textContent = `像素 ${s.w}×${s.h} ｜ 约 ${s.wmm.toFixed(1)}×${s.hmm.toFixed(1)} mm（按300DPI）`;
}
// 换底色立即生效；仅在还没抠图时提示需要先点第 4 步（不自动触发，避免点颜色卡几分钟）
function hintNeedAI() {
  if (state.srcImg && !state.cutImg && !state.keepBg && !state.aiBusy) {
    setStatus("换底色需要先抠图：请点击第 4 步「一键 AI 生成」。\n只需抠图一次，之后切换底色都是即时生效。");
  }
}

// 移动端环境判定（桌面端窗口 <=768 也走移动端 UI）
const isMobileEnv = state.isMobile || window.innerWidth <= 768;
