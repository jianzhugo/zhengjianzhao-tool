# 证件照工具（ID Photo Tool）

一个 100% 本地运行的 AI 证件照工具：尺寸修改、AI 换底色、文件大小控制、相纸排版打印，**照片不上传任何服务器**。

作者：AI扫盲班长·**長青**，移动端适配：**水常**。

**部署到任何静态托管即可使用：EdgeOne Pages、GitHub Pages、Vercel、Netlify、Cloudflare Pages 等。

---

## ✨ 功能特性

- 📐 **16 种预设规格**：一寸 / 二寸 / 小一寸 / 大一寸 / 教师资格证 / 国考 / 四六级 / 社保卡 / 五寸 / 自定义等
- 🎨 **底色一键切换**：白色 / 红色 / 蓝色 / 深蓝 / 浅灰 / 自定义 HEX / 取色器，**抠图一次后切换底色即时生效**
- 🤖 **AI 抠图换底色**：基于 [transformers.js](https://github.com/huggingface/transformers.js) + RMBG-1.4 模型，浏览器内本地推理
- 👤 **AI 人脸检测**：基于 [face-api.js](https://github.com/justadudewhohacks/face-api.js)，自动定位人脸、估算头顶位置
- 🪞 **轻度美化**：柔和提亮 + 皮肤轻磨皮 + 眼周提亮 + 轻锐化（不联网，可调强度）
- 🖼️ **前后对比滑杆**：拖动中缝对比原图 / 成品
- 📄 **相纸排版打印**：6 寸 / A6 / A5 / A4 相纸，竖向 / 横向，按 300 DPI 输出，附裁剪参考线
- 📦 **批量导出**：多规格 × 多底色组合，桌面端打包 ZIP，移动端逐张下载
- 📏 **文件大小控制**：JPG 质量自动迭代压缩到目标 KB（适配各类报名系统）
- 🧹 **抠图质量优化**：双阈值磁滞重建 + 闭运算填孔 + 反混色 + 边缘颜色净化，处理碎发与白边
- 📱 **响应式设计**：桌面端单页控制台 + 移动端 7 步向导式流程，自动适配

---

## 🚀 快速开始

### 方式一：直接打开

下载本项目，双击 `index.html` 即可在浏览器中使用（推荐 Chrome / Edge）。

> 首次使用 AI 功能时浏览器会从 CDN 下载模型文件（约 88MB），下载完成后即可离线使用。

### 方式二：本地预览服务器

```bash
# 进入项目目录
cd zhengjianzhao-tool

# 启动任意静态服务器
python -m http.server 8765
# 或
npx serve .
```

访问 http://localhost:8765/

### 方式三：部署到静态托管

本项目为纯静态站点，无构建步骤。直接上传整个目录即可。

**EdgeOne Pages / GitHub Pages / Vercel / Netlify：**

1. 关联本仓库（或上传文件夹）
2. 构建命令：留空
3. 输出目录：`/` 或 `.`
4. 入口文件：`index.html`（自动识别）

---

## 📁 项目结构

```
zhengjianzhao-tool/
├── index.html              # 默认入口
├── favicon.svg             # 站点图标
├── css/
│   └── styles.css          # 全部样式（桌面端 + 移动端 @media）
└── js/
    ├── config.js           # 数据常量、state、DOM 工具、currentSize、isMobileEnv
    ├── image-processing.js # 遮罩清理、反混色、颜色净化、美化滤镜
    ├── ai.js               # 人脸检测、transformers.js 抠图
    ├── render.js           # 定位、合成渲染、前后对比滑杆
    ├── export.js           # 导出、批量打包、相纸排版
    ├── desktop-ui.js       # 桌面端 UI 初始化与事件绑定
    └── mobile-ui.js        # 移动端 UI、步骤导航、覆盖逻辑
```

### JS 加载顺序

使用 `<script defer>` 按依赖顺序加载，保持 `file://` 直接打开可用（无需本地服务器）：

```
config → image-processing → ai → render → export → desktop-ui → mobile-ui
```

---

## 🛠️ 技术栈

| 模块 | 技术 |
|---|---|
| 前端 | 原生 HTML / CSS / JavaScript（无框架、无构建） |
| AI 抠图 | [transformers.js](https://github.com/huggingface/transformers.js) v3.8.1 + RMBG-1.4 模型（fp16） |
| 人脸检测 | [face-api.js](https://github.com/justadudewhohacks/face-api.js) v0.22.2 + TinyFaceDetector |
| 批量打包 | [JSZip](https://stuk.github.io/jszip/) v3.10.1（按需 CDN 加载） |
| 图像处理 | Canvas 2D API + 自实现形态学 / 反混色 / 颜色净化算法 |
| 字体 | "Microsoft YaHei" / "PingFang SC" 系统字体 |

### CDN 多源容错

外部依赖（face-api.js、transformers.js、JSZip、AI 模型权重）均内置多 CDN 源容错：

- `cdn.jsdelivr.net` → `fastly.jsdelivr.net` → `gcore.jsdelivr.net` → `unpkg.com`
- AI 模型：`hf-mirror.com`（国内可达）→ `huggingface.co`

任一源不可达自动换源，无需用户干预。

---

## 📖 使用指南

### 桌面端

1. **打开照片**：点击或拖拽上传
2. **选择规格**：从 16 种预设中选，或自定义宽高
3. **选择底色**：色块 / 取色器 / HEX 输入，或勾选「保留原背景」
4. **手动调整**：缩放 / 水平 / 垂直 / 美化强度，所见即所得
5. **一键 AI 生成**：自动抠图 + 定位（首次需下载模型）
6. **导出证件照**：选 JPG/PNG，可设大小上限（KB）
7. **批量导出**：多规格 × 多底色组合打包下载

### 移动端

7 步向导式流程：打开照片 → 选规格 → 选底色 → 手动调整 → AI 生成 → 导出 → 批量导出。底部带步骤指示器，支持上一步 / 下一步导航。

---

## 🔒 隐私说明

**所有照片处理 100% 在浏览器本地完成，不会上传到任何服务器。**

- AI 模型在首次使用时从 CDN 下载到浏览器缓存，之后离线可用
- 不收集任何用户数据
- 不调用任何后端 API
- 适合处理敏感证件照

---

## ⚠️ 常见问题

**Q：AI 抠图首次很慢？**
A：首次需下载约 88MB 模型文件并编译初始化（1~3 分钟），之后完全离线即时可用。

**Q：公司网 / 校园网下 AI 功能失败？**
A：通常是网络拦截了 CDN。建议换手机热点重试，或勾选「保留原背景」后用「仅裁剪排版」（不联网）。

**Q：导出的照片有白边？**
A：已内置边缘颜色净化算法处理碎发白边。若仍有残留，可在「手动调整」微调缩放与位置。

**Q：支持哪些浏览器？**
A：Chrome / Edge / Safari 最新版（需支持 WebAssembly 与 ES2017+）。

---

## 📄 许可证

本项目代码采用 [MIT License](LICENSE) 开源。

AI 模型权重遵循各自原始许可证：
- RMBG-1.4：[briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4)
- face-api.js 权重：[justadudewhohacks/face-api.js](https://github.com/justadudewhohacks/face-api.js)

---

## 🙏 致谢

- [Hugging Face](https://huggingface.co/) - transformers.js 与模型托管
- [justadudewhohacks](https://github.com/justadudewhohacks) - face-api.js
- [Stuk](https://github.com/Stuk/jszip) - JSZip
- [jsDelivr](https://www.jsdelivr.com/) - CDN 服务
