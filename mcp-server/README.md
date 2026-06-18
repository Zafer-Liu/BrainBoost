# BrainSpark MCP Server

将 BrainSpark 的核心 AI 能力封装为本地 MCP（Model Context Protocol）服务，让 Claude Desktop、Cursor 等支持 MCP 的工具可以直接调用头脑风暴分析功能，无需打开浏览器。

## 暴露的工具

| 工具名 | 功能 |
|--------|------|
| `analyze_keywords` | 输入主题 + 关键词 → 思维导图节点、关联边、推导方案卡片 |
| `diagnose_keywords` | 诊断关键词质量：语义分组、矛盾词对、相近词、缺失维度 |
| `write_plan_detail` | 输入方案卡片信息 → 完整 Markdown 方案文档（600-1200 字） |

---

## 快速开始

### 1. 安装依赖 & 构建

```bash
cd mcp-server
npm install
npm run build
```

构建产物为 `dist/index.js`。

### 2. 配置 Claude Desktop

编辑 Claude Desktop 配置文件（通常位于下方路径），添加 BrainSpark 服务：

**Windows：** `%APPDATA%\Claude\claude_desktop_config.json`  
**macOS：** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "brainspark": {
      "command": "node",
      "args": ["D:/path/to/Mindmap/mcp-server/dist/index.js"],
      "env": {
        "BRAINSPARK_PROVIDER": "claude",
        "BRAINSPARK_API_KEY": "sk-ant-xxxxxxxxxxxxxxxxxx",
        "BRAINSPARK_MODEL": "claude-sonnet-4-5"
      }
    }
  }
}
```

> 修改 `args` 中的路径为你本机的实际路径（使用正斜杠或转义反斜杠）。

### 3. 配置 Cursor

在 Cursor 设置 → MCP 中添加：

```json
{
  "brainspark": {
    "command": "node",
    "args": ["D:/path/to/Mindmap/mcp-server/dist/index.js"],
    "env": {
      "BRAINSPARK_PROVIDER": "claude",
      "BRAINSPARK_API_KEY": "sk-ant-xxxxxxxxxxxxxxxxxx",
      "BRAINSPARK_MODEL": "claude-sonnet-4-5"
    }
  }
}
```

---

## 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `BRAINSPARK_API_KEY` | ✅ | 你的 API 密钥（Anthropic 或 OpenAI） |
| `BRAINSPARK_PROVIDER` | 可选 | `claude` / `openai` / `custom`，默认 `claude` |
| `BRAINSPARK_MODEL` | 可选 | 模型名，默认 `claude-sonnet-4-5`（Claude）或 `gpt-4o`（OpenAI） |
| `BRAINSPARK_BASE_URL` | 可选 | 自定义服务 baseURL，`provider=custom` 时使用 |

---

## 使用示例

配置完成后，在 Claude Desktop 中直接对话：

> **你：** 帮我用 analyze_keywords 分析"如何提高团队效率"，关键词：沟通、目标管理、激励机制、绩效考核、团队文化

Claude 会调用 MCP 工具，返回包含思维导图节点、关联边和推导方案的完整结果。

> **你：** 诊断一下这些关键词：降本、增效、扩招、裁员、精细化运营

Claude 会识别矛盾词对（如"扩招"vs"裁员"）并给出优化建议。

---

## 支持的 LLM 服务

| Provider | 说明 |
|----------|------|
| `claude` | Anthropic Claude API（推荐 `claude-sonnet-4-5` 及以上） |
| `openai` | OpenAI API（推荐 `gpt-4o`） |
| `custom` | 任意兼容 OpenAI Chat Completions 接口的服务（设置 `BRAINSPARK_BASE_URL`） |

---

## 本地调试

不使用 MCP 客户端时，可以直接测试服务是否正常启动：

```bash
# 设置环境变量后直接运行（会等待 stdin 输入 MCP 协议消息）
BRAINSPARK_API_KEY=your-key node dist/index.js
# 看到 stderr 输出 "BrainSpark MCP Server 已启动" 说明正常
# Ctrl+C 退出
```
