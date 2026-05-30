# 🧠 BrainBoost

### AI-Powered Brainstorming Made Visual

[🇨🇳 中文](./README.md) · [🇺🇸 English](./README_EN.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Zafer-Liu/BrainBoost/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![React](https://img.shields.io/badge/react-18-61dafb.svg)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5-blue.svg)](https://www.typescriptlang.org)

**AI 辅助头脑风暴工具** — 输入关键词，AI 自动生成思维导图与推导方案，所有内容可视化编辑后一键导出。

[快速开始](#快速开始) · [功能演示](#功能演示) · [技术栈](#技术栈) · [贡献](#贡献) · [License](#license)

---

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🗣️ **语音关键词** | 文字输入或语音识别，批量添加关键词 |
| 🤖 **AI 智能分析** | 调用 Claude / OpenAI / 自定义模型，流式生成思维导图和方案 |
| 🗺️ **交互式思维导图** | 可拖拽、编辑节点、添加关联、锁定节点 |
| 🔍 **关键词诊断** | AI 自动识别相近词、矛盾词、缺失维度，一键清理 |
| 💡 **推导方案** | AI 生成多个可行方案卡片，支持详细撰写与对话修改 |
| 📝 **笔记 Note** | 补充背景要求或限制条件，随关键词一起发给 AI |
| 🔒 **锁定机制** | 锁定满意的节点或方案，AI 在此基础上优化而非全量覆盖 |
| 📤 **多格式导出** | Markdown / Word(.docx) / 思维导图图片(.png) |

---

## 🎬 功能演示

```
输入主题 → 添加关键词 → AI 生成思维导图 → 编辑优化 → 导出成果
```

### 典型工作流

1. **新建会话**，输入主题（如「如何提高团队效率」）
2. **添加关键词**（支持语音输入，可批量）
3. 可选：在「笔记 Note」补充背景要求或限制条件
4. 点击「AI 分析关联」→ 思维导图和方案自动生成
5. **编辑思维导图**：拖拽节点、调整关联、锁定满意内容
6. 查看方案卡片，点击「查看详细方案」让 AI 全文撰写
7. 导出为 Markdown / Word / 图片

---

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) **18 或以上**
- [npm](https://www.npmjs.com/) 9+
- 现代浏览器（Chrome / Edge / Firefox）
- 以下任一 AI 服务的 API Key：
  - [Anthropic Claude](https://console.anthropic.com/)（推荐）
  - [OpenAI](https://platform.openai.com/)
  - 任意兼容 OpenAI 接口的自定义服务

### 安装

```bash
# 克隆仓库
git clone https://github.com/Zafer-Liu/BrainBoost.git
cd BrainBoost

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

浏览器打开 [http://localhost:5173](http://localhost:5173)

> **Windows 用户**：双击根目录 `start.bat`，自动检查环境、安装依赖并启动。

### 配置 API Key

首次使用点击右上角「设置」图标，填写：

| 配置项 | 说明 |
|--------|------|
| **Provider** | 选择 Claude / OpenAI / 自定义 |
| **API Key** | 填入对应密钥 |
| **Model** | 推荐 `deepseek-v4-flash` 或 `gpt-4o` |

> ⚠️ API Key 仅保存在**本地浏览器**，不会上传到任何服务器。

---

## 🛠️ 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18 + TypeScript | 类型安全，现代化开发体验 |
| 构建工具 | Vite 6 | 极速 HMR，开发效率翻倍 |
| 思维导图 | ReactFlow 11 | 交互式画布，支持自定义节点 |
| 布局算法 | d3-force | 力导向图自动布局 |
| AI 接入 | Anthropic SDK / OpenAI SDK | 支持 Claude / GPT / 兼容接口 |
| 文档导出 | docx + html-to-image | Word + 图片导出 |
| 图标 | Lucide React | 简洁现代的图标库 |

---

## 📁 项目结构

```
BrainBoost/
├── start.bat              # Windows 一键启动
├── index.html
├── package.json
├── vite.config.ts
├── scripts/
│   └── log-server.mjs     # 本地日志服务（开发用）
└── src/
    ├── styles/App.css
    ├── types/index.ts      # 全局类型定义
    ├── store/appStore.ts   # 状态管理（Zustand）
    ├── services/
    │   ├── llmService.ts   # LLM 调用 + 流式解析
    │   ├── exportService.ts# 导出功能
    │   └── logger.ts
    ├── hooks/
    │   └── useSpeechInput.ts # 语音识别
    └── components/
        ├── layout/         # HomeView / SessionView / SettingsView
        ├── mindmap/        # MindMapView
        ├── keywords/       # KeywordPanel / KeywordAnalysisModal
        └── ideas/          # IdeaCardsPanel / PlanDetailModal
```

---

## 🏗️ 本地构建

```bash
# 生产构建（输出到 dist/）
npm run build

# 预览构建产物
npm run preview
```

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

---

## 📄 License

[MIT](LICENSE) © 2026 BrainBoost Contributors