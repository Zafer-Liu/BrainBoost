#!/usr/bin/env node
/**
 * BrainSpark MCP Server
 *
 * 本地 stdio MCP 服务，将 BrainSpark 核心 LLM 能力暴露给 Claude Desktop / Cursor 等工具。
 *
 * 环境变量（必须至少设置前三个之一）：
 *   BRAINSPARK_PROVIDER   claude | openai | custom （默认 claude）
 *   BRAINSPARK_API_KEY    API 密钥
 *   BRAINSPARK_MODEL      模型名（默认：claude-sonnet-4-5 / gpt-4o）
 *   BRAINSPARK_BASE_URL   自定义 baseURL（provider=custom 时使用）
 *
 * 暴露的工具：
 *   analyze_keywords     — 输入主题+关键词 → 思维导图节点+边+推导方案
 *   diagnose_keywords    — 输入主题+关键词 → 分组/矛盾/重复/缺失维度诊断
 *   write_plan_detail    — 输入方案卡片信息 → 完整 Markdown 方案文档
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { v4 as uuidv4 } from 'uuid'

// ─── 配置 ─────────────────────────────────────────────────────────
type Provider = 'claude' | 'openai' | 'custom'

interface LLMConfig {
  provider: Provider
  apiKey: string
  model: string
  baseURL?: string
}

function getConfig(): LLMConfig {
  const provider = (process.env.BRAINSPARK_PROVIDER ?? 'claude') as Provider
  const apiKey = process.env.BRAINSPARK_API_KEY ?? ''
  const baseURL = process.env.BRAINSPARK_BASE_URL
  const defaultModel = provider === 'claude' ? 'claude-sonnet-4-5' : 'gpt-4o'
  const model = process.env.BRAINSPARK_MODEL ?? defaultModel
  return { provider, apiKey, model, baseURL }
}

// ─── 类型 ─────────────────────────────────────────────────────────
interface MindNode {
  id: string
  label: string
  group?: string
  keywords: string[]
}

interface MindEdge {
  source: string
  target: string
  label?: string
}

interface IdeaCard {
  id: string
  title: string
  content: string
  relatedKeywords: string[]
  relatedNodeIds: string[]
}

interface AnalysisResult {
  nodes: MindNode[]
  edges: MindEdge[]
  ideaCards: IdeaCard[]
}

interface KeywordGroup {
  name: string
  keywords: string[]
}
interface KeywordConflict {
  a: string
  b: string
  reason: string
}
interface KeywordDuplicate {
  words: string[]
  suggestion: string
}
interface KeywordMissing {
  dimension: string
  examples: string[]
}
interface DiagnoseResult {
  groups: KeywordGroup[]
  conflicts: KeywordConflict[]
  duplicates: KeywordDuplicate[]
  missing: KeywordMissing[]
}

// ─── JSON 解析工具 ─────────────────────────────────────────────────
function extractArray(text: string, key: string): string | null {
  const keyIdx = text.indexOf(`"${key}"`)
  if (keyIdx === -1) return null
  const bracketStart = text.indexOf('[', keyIdx)
  if (bracketStart === -1) return null

  let depth = 0
  let inStr = false
  let esc = false

  for (let i = bracketStart; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(bracketStart, i + 1)
    }
  }
  return null
}

function extractObjects(arrayStr: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  let depth = 0
  let inStr = false
  let esc = false
  let start = -1

  for (let i = 0; i < arrayStr.length; i++) {
    const ch = arrayStr[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        try {
          results.push(JSON.parse(arrayStr.slice(start, i + 1)))
        } catch { /* skip */ }
        start = -1
      }
    }
  }
  return results
}

function stripThink(text: string): string {
  const thinkEnd = text.lastIndexOf('</think>')
  return thinkEnd >= 0 ? text.slice(thinkEnd + 8).trim() : text.trim()
}

// ─── HTTP 请求（非流式，MCP 不需要流式输出） ────────────────────
async function callLLM(
  config: LLMConfig,
  messages: { role: string; content: string }[],
  maxTokens = 8000,
): Promise<string> {
  if (!config.apiKey) throw new Error('BRAINSPARK_API_KEY 未设置，请在 MCP 配置中填写环境变量')

  let resp: Response

  if (config.provider === 'claude') {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-request-header': 'true',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        stream: false,
        messages,
      }),
    })
    if (!resp.ok) {
      const err = await resp.text()
      throw new Error(`Anthropic API 错误 ${resp.status}: ${err}`)
    }
    const data = await resp.json() as { content: { type: string; text: string }[] }
    return data.content?.find(b => b.type === 'text')?.text ?? ''
  } else {
    const baseURL = config.baseURL || 'https://api.openai.com/v1'
    resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: maxTokens,
        stream: false,
      }),
    })
    if (!resp.ok) {
      const err = await resp.text()
      throw new Error(`OpenAI API 错误 ${resp.status}: ${err}`)
    }
    const data = await resp.json() as {
      choices: { message: { content: string } }[]
    }
    return data.choices?.[0]?.message?.content ?? ''
  }
}

// ─── 工具实现 ─────────────────────────────────────────────────────

/** analyze_keywords: 生成思维导图节点、边、推导方案 */
async function analyzeKeywords(
  config: LLMConfig,
  topic: string,
  keywords: string[],
  notes?: string,
): Promise<AnalysisResult> {
  const notesSection = notes?.trim() ? `\n背景备注与要求（优先参考）：\n${notes.trim()}\n` : ''

  const prompt = `你是头脑风暴分析助手。主题："${topic}"，关键词：

${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}
${notesSection}
只输出如下 JSON，不要任何多余文字或代码块标记：

{
  "nodes": [
    { "id": "n1", "label": "节点名称（8字以内）", "group": "分组名", "keywords": ["关键词"] }
  ],
  "edges": [
    { "source": "n1", "target": "n2", "label": "关联说明（6字以内）" }
  ],
  "ideaCards": [
    {
      "title": "方案标题",
      "content": "方案详细描述（150字以内）",
      "relatedKeywords": ["关键词"],
      "relatedNodeIds": ["n1", "n2"]
    }
  ]
}

要求：
- nodes：围绕每个关键词展开 2-4 个子节点，共 15-25 个节点，分 4-6 个分组，label 用清晰易懂的词语
- edges：20-30 条，充分连接相关节点，label 说明两节点间的具体关联关系
- ideaCards：3-5 个具体可执行方案，每个方案的 relatedNodeIds 必须引用上面 nodes 里真实存在的 id（至少 3 个）
- 所有文字用中文`

  const raw = await callLLM(config, [{ role: 'user', content: prompt }], 100000)
  const parseable = stripThink(raw)

  const nodesStr = extractArray(parseable, 'nodes')
  const edgesStr = extractArray(parseable, 'edges')
  const cardsStr = extractArray(parseable, 'ideaCards')

  const nodes: MindNode[] = nodesStr
    ? extractObjects(nodesStr).map(n => ({
        id: (n.id as string) || uuidv4(),
        label: (n.label as string) || '',
        group: n.group as string | undefined,
        keywords: (n.keywords as string[]) || [],
      }))
    : []

  const edges: MindEdge[] = edgesStr
    ? extractObjects(edgesStr).map(e => ({
        source: (e.source as string) || '',
        target: (e.target as string) || '',
        label: e.label as string | undefined,
      }))
    : []

  const ideaCards: IdeaCard[] = cardsStr
    ? extractObjects(cardsStr).map(c => ({
        id: uuidv4(),
        title: (c.title as string) || '',
        content: (c.content as string) || '',
        relatedKeywords: (c.relatedKeywords as string[]) || [],
        relatedNodeIds: (c.relatedNodeIds as string[]) || [],
      }))
    : []

  return { nodes, edges, ideaCards }
}

/** diagnose_keywords: 诊断关键词分组/矛盾/重复/缺失 */
async function diagnoseKeywords(
  config: LLMConfig,
  topic: string,
  keywords: string[],
): Promise<DiagnoseResult> {
  const prompt = `你是头脑风暴关键词诊断专家。主题："${topic}"

当前关键词列表：
${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

只输出如下 JSON，不要任何多余文字或代码块标记：

{
  "groups": [
    { "name": "分组名称", "keywords": ["词1", "词2"] }
  ],
  "conflicts": [
    { "a": "词A", "b": "词B", "reason": "冲突原因简述（20字内）" }
  ],
  "duplicates": [
    { "words": ["词1", "词2"], "suggestion": "建议保留或合并为" }
  ],
  "missing": [
    { "dimension": "缺失维度名", "examples": ["建议词1", "建议词2"] }
  ]
}

要求：
- groups：将关键词按语义归类，每组 2-6 个，组名简洁（4字内），每个词只属于一个组
- conflicts：找出语义矛盾或方向相反的词对，若无则为空数组
- duplicates：找出含义高度相近或重复的词组，若无则为空数组
- missing：当前词列覆盖不足的重要维度，给出 2-4 个建议，每个维度举例 2-3 个词
- 所有词必须来自原始关键词列表（missing.examples 除外，可以是新词）
- 用中文`

  const raw = await callLLM(config, [{ role: 'user', content: prompt }])
  const parseable = stripThink(raw)
    .replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()

  const parsed = JSON.parse(parseable)
  return {
    groups: parsed.groups ?? [],
    conflicts: parsed.conflicts ?? [],
    duplicates: parsed.duplicates ?? [],
    missing: parsed.missing ?? [],
  }
}

/** write_plan_detail: 针对方案卡片，AI 全文撰写完整方案文档 */
async function writePlanDetail(
  config: LLMConfig,
  cardTitle: string,
  cardContent: string,
  relatedKeywords: string[],
  topic: string,
  keywords: string[],
  notes?: string,
): Promise<string> {
  const notesSection = notes?.trim() ? `\n背景备注：${notes.trim()}\n` : ''
  const prompt = `你是专业方案撰写助手。请根据以下信息，撰写一份完整、详细、可执行的方案文档。

主题：${topic}
关键词：${keywords.join('、')}${notesSection}

方案标题：${cardTitle}
方案概要：${cardContent}
相关关键词：${relatedKeywords.join('、')}

要求：
- 用中文撰写，结构清晰，使用 Markdown 格式（标题、列表、分节）
- 包含：背景分析、目标、具体步骤/执行计划、所需资源、注意事项、预期成果
- 内容详实具体，可直接参考执行，篇幅 600-1200 字
- 只输出方案正文，不要任何开场白或结语`

  const raw = await callLLM(config, [{ role: 'user', content: prompt }], 8000)
  return stripThink(raw)
}

// ─── 格式化输出 ───────────────────────────────────────────────────
function formatAnalysisResult(result: AnalysisResult): string {
  const lines: string[] = []

  lines.push(`## 思维导图节点（${result.nodes.length} 个）\n`)

  // 按 group 分组显示
  const groups = new Map<string, MindNode[]>()
  for (const node of result.nodes) {
    const g = node.group || '未分组'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(node)
  }
  for (const [groupName, nodes] of groups) {
    lines.push(`### ${groupName}`)
    for (const n of nodes) {
      lines.push(`- **${n.label}** (id: \`${n.id}\`)${n.keywords.length ? ' — ' + n.keywords.join('、') : ''}`)
    }
    lines.push('')
  }

  lines.push(`## 关联边（${result.edges.length} 条）\n`)
  for (const e of result.edges) {
    lines.push(`- \`${e.source}\` → \`${e.target}\`${e.label ? ` （${e.label}）` : ''}`)
  }

  lines.push(`\n## 推导方案（${result.ideaCards.length} 个）\n`)
  for (let i = 0; i < result.ideaCards.length; i++) {
    const card = result.ideaCards[i]
    lines.push(`### 方案 ${i + 1}：${card.title}`)
    lines.push(card.content)
    lines.push(`\n> 关联关键词：${card.relatedKeywords.join('、')}`)
    lines.push(`> 关联节点：${card.relatedNodeIds.map(id => `\`${id}\``).join(', ')}`)
    lines.push('')
  }

  // 附上原始 JSON 供程序化使用
  lines.push(`---\n\n<details>\n<summary>原始 JSON 数据（供程序调用）</summary>\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\n</details>`)

  return lines.join('\n')
}

function formatDiagnoseResult(result: DiagnoseResult, keywords: string[]): string {
  const lines: string[] = []

  lines.push(`## 关键词诊断报告\n`)
  lines.push(`原始关键词（${keywords.length} 个）：${keywords.join('、')}\n`)

  lines.push(`### 语义分组（${result.groups.length} 组）\n`)
  for (const g of result.groups) {
    lines.push(`**${g.name}**：${g.keywords.join('、')}`)
  }

  if (result.conflicts.length > 0) {
    lines.push(`\n### ⚠️ 矛盾词对（${result.conflicts.length} 对）\n`)
    for (const c of result.conflicts) {
      lines.push(`- **${c.a}** vs **${c.b}** — ${c.reason}`)
    }
  } else {
    lines.push(`\n### ✅ 矛盾词对：无`)
  }

  if (result.duplicates.length > 0) {
    lines.push(`\n### 🔁 相近/重复词（${result.duplicates.length} 组）\n`)
    for (const d of result.duplicates) {
      lines.push(`- ${d.words.join('、')} → 建议：${d.suggestion}`)
    }
  } else {
    lines.push(`\n### ✅ 相近词：无`)
  }

  if (result.missing.length > 0) {
    lines.push(`\n### 💡 缺失维度建议（${result.missing.length} 个）\n`)
    for (const m of result.missing) {
      lines.push(`- **${m.dimension}**：${m.examples.join('、')}`)
    }
  }

  lines.push(`\n---\n\n<details>\n<summary>原始 JSON 数据（供程序调用）</summary>\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\n</details>`)

  return lines.join('\n')
}

// ─── MCP Server ───────────────────────────────────────────────────
const server = new Server(
  { name: 'brainspark', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'analyze_keywords',
      description: '对主题和关键词进行头脑风暴分析，生成思维导图节点、关联边和推导方案卡片。适合用于想法发散、结构化分析和方案推导。',
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: '头脑风暴主题，如"如何提高团队效率"',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '关键词列表，至少 2 个，如 ["沟通", "目标管理", "激励机制"]',
            minItems: 2,
          },
          notes: {
            type: 'string',
            description: '（可选）补充背景说明、限制条件或特殊要求，会优先参考',
          },
        },
        required: ['topic', 'keywords'],
      },
    },
    {
      name: 'diagnose_keywords',
      description: '诊断关键词列表的质量问题：识别矛盾词对、相近/重复词、按语义分组，并建议缺失的重要维度。适合在开始头脑风暴前整理和优化关键词。',
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: '头脑风暴主题',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '待诊断的关键词列表，至少 2 个',
            minItems: 2,
          },
        },
        required: ['topic', 'keywords'],
      },
    },
    {
      name: 'write_plan_detail',
      description: '根据方案卡片信息，AI 撰写一份完整、详细、可执行的方案文档（Markdown 格式，600-1200 字）。包含背景分析、目标、执行步骤、所需资源、注意事项和预期成果。',
      inputSchema: {
        type: 'object',
        properties: {
          card_title: {
            type: 'string',
            description: '方案标题',
          },
          card_content: {
            type: 'string',
            description: '方案概要描述（100-150字）',
          },
          related_keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '方案相关的关键词',
          },
          topic: {
            type: 'string',
            description: '整体头脑风暴主题',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '全部关键词列表',
          },
          notes: {
            type: 'string',
            description: '（可选）背景备注，会优先参考',
          },
        },
        required: ['card_title', 'card_content', 'related_keywords', 'topic', 'keywords'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const config = getConfig()
  const { name, arguments: args } = request.params

  if (!args) {
    return { content: [{ type: 'text', text: '缺少参数' }], isError: true }
  }

  try {
    if (name === 'analyze_keywords') {
      const { topic, keywords, notes } = args as {
        topic: string
        keywords: string[]
        notes?: string
      }
      if (!topic || !Array.isArray(keywords) || keywords.length < 2) {
        return {
          content: [{ type: 'text', text: '参数错误：topic 和至少 2 个 keywords 必填' }],
          isError: true,
        }
      }
      const result = await analyzeKeywords(config, topic, keywords, notes)
      return {
        content: [{ type: 'text', text: formatAnalysisResult(result) }],
      }
    }

    if (name === 'diagnose_keywords') {
      const { topic, keywords } = args as {
        topic: string
        keywords: string[]
      }
      if (!topic || !Array.isArray(keywords) || keywords.length < 2) {
        return {
          content: [{ type: 'text', text: '参数错误：topic 和至少 2 个 keywords 必填' }],
          isError: true,
        }
      }
      const result = await diagnoseKeywords(config, topic, keywords)
      return {
        content: [{ type: 'text', text: formatDiagnoseResult(result, keywords) }],
      }
    }

    if (name === 'write_plan_detail') {
      const { card_title, card_content, related_keywords, topic, keywords, notes } = args as {
        card_title: string
        card_content: string
        related_keywords: string[]
        topic: string
        keywords: string[]
        notes?: string
      }
      if (!card_title || !card_content || !topic || !Array.isArray(keywords)) {
        return {
          content: [{ type: 'text', text: '参数错误：card_title、card_content、topic、keywords 必填' }],
          isError: true,
        }
      }
      const doc = await writePlanDetail(
        config,
        card_title,
        card_content,
        related_keywords ?? [],
        topic,
        keywords,
        notes,
      )
      return {
        content: [{ type: 'text', text: doc }],
      }
    }

    return {
      content: [{ type: 'text', text: `未知工具：${name}` }],
      isError: true,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `执行失败：${message}` }],
      isError: true,
    }
  }
})

// ─── 启动 ─────────────────────────────────────────────────────────
const transport = new StdioServerTransport()
await server.connect(transport)
// stderr only — stdout is reserved for MCP protocol
process.stderr.write('BrainSpark MCP Server 已启动\n')
