import type { LLMConfig, IdeaCard, ChatMessage, LockedContext } from '../types'
import { logger } from './logger'

const MOD = 'LLMPrompts'

// ─── Prompts ──────────────────────────────────────────────────────

export function buildAnalyzePrompt(
  topic: string,
  keywords: string[],
  notes?: string,
  locked?: LockedContext,
): string {
  const notesSection = notes?.trim()
    ? `\n背景备注与要求（优先参考）：\n${notes.trim()}\n`
    : ''

  let lockedSection = ''
  if (locked && (locked.nodes.length > 0 || locked.cards.length > 0)) {
    lockedSection = '\n【锁定内容——必须保留，id 和 label 原样输出到结果中】\n'
    if (locked.nodes.length > 0) {
      lockedSection += '已锁定节点（nodes 中必须包含这些，id 和 label 不变）：\n'
      lockedSection += locked.nodes.map(n =>
        `  - id: "${n.id}", label: "${n.label}", group: "${n.group ?? ''}"`,
      ).join('\n') + '\n'
    }
    if (locked.cards.length > 0) {
      lockedSection += '已锁定方案（ideaCards 中必须包含这些，title 和 content 不变）：\n'
      lockedSection += locked.cards.map(c =>
        `  - title: "${c.title}", content: "${c.content}"`,
      ).join('\n') + '\n'
    }
    lockedSection += '可在锁定内容基础上新增节点和方案，优化连接关系，但不得修改或删除上述锁定项。\n'
  }

  return `你是头脑风暴分析助手。主题："${topic}"，关键词：

${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}
${notesSection}${lockedSection}
思考完成后，只输出如下 JSON，不要任何多余文字或代码块标记，第一个字符必须是 {：

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
- nodes：围绕每个关键词展开 2-4 个子节点，共 15-25 个节点，分 4-6 个分组，label 用清晰易懂的词语（非缩写）
- edges：20-30 条，充分连接相关节点，label 说明两节点间的具体关联关系
- ideaCards：3-5 个具体可执行方案，每个方案的 relatedNodeIds 必须引用上面 nodes 里真实存在的 id（至少 3 个）
- 所有文字用中文`
}

export function buildWritePlanPrompt(
  card: IdeaCard,
  context: { topic: string; keywords: string[]; notes?: string },
): string {
  const notesSection = context.notes?.trim()
    ? `\n背景备注：${context.notes.trim()}\n` : ''
  return `你是专业方案撰写助手。请根据以下信息，撰写一份完整、详细、可执行的方案文档。

主题：${context.topic}
关键词：${context.keywords.join('、')}${notesSection}

方案标题：${card.title}
方案概要：${card.content}
相关关键词：${card.relatedKeywords.join('、')}

要求：
- 用中文撰写，结构清晰，使用 Markdown 格式（标题、列表、分节）
- 包含：背景分析、目标、具体步骤/执行计划、所需资源、注意事项、预期成果
- 内容详实具体，可直接参考执行，篇幅 600-1200 字
- 只输出方案正文，不要任何开场白或结语`
}

export function buildChatSystemPrompt(docContent: string): string {
  return `你是方案修改助手。当前正在编辑的方案文档如下：

---
${docContent}
---

用户可能要求你：修改某段内容、补充细节、调整结构、重写某节、或回答问题。
- 如果用户要求修改文档，直接输出**完整的修改后文档**（Markdown 格式），不要只输出差异
- 如果用户只是提问或讨论，正常回答即可，不需要输出完整文档
- 输出时不要包含任何前言或"以下是修改后的文档："之类的句子，直接给出内容`
}

export function buildKeywordAnalysisPrompt(topic: string, keywords: string[]): string {
  return `你是头脑风暴关键词诊断专家。主题："${topic}"

当前关键词列表：
${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

请对这些关键词进行全面诊断，只输出如下 JSON，不要任何多余文字或代码块标记，第一个字符必须是 {：

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
}

export { logger, MOD }
export type { LLMConfig, ChatMessage }
