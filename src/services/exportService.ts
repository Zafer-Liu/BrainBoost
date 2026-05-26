import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx'
import { toPng } from 'html-to-image'
import type { Session } from '../types'
import { logger } from './logger'

const MOD = 'ExportService'

export async function exportMarkdown(session: Session): Promise<void> {
  logger.info(MOD, '导出 Markdown', { topic: session.topic, keywords: session.keywords.length, cards: session.ideaCards.length })
  const lines: string[] = [
    `# ${session.topic}`,
    '',
    `> 创建于 ${new Date(session.createdAt).toLocaleString('zh-CN')}`,
    '',
    '## 关键词',
    '',
    session.keywords.map(k => `- ${k.text}`).join('\n'),
    '',
    '## AI 分析方案',
    '',
    ...session.ideaCards.flatMap(card => [
      `### ${card.title}`,
      '',
      card.content,
      '',
      `**相关关键词：** ${card.relatedKeywords.join('、')}`,
      '',
    ]),
    '## 思维导图节点',
    '',
    ...(session.mindNodes.map(n => `- **${n.label}**${n.group ? ` (${n.group})` : ''}`)),
  ]

  const content = lines.join('\n')
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  downloadBlob(blob, `${session.topic}-头脑风暴.md`)
  logger.info(MOD, 'Markdown 导出完成', { bytes: content.length })
}

export async function exportDocx(session: Session): Promise<void> {
  logger.info(MOD, '导出 DOCX', { topic: session.topic })
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: session.topic,
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `创建于 ${new Date(session.createdAt).toLocaleString('zh-CN')}`,
              color: '888888',
              size: 20,
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '关键词', heading: HeadingLevel.HEADING_1 }),
        ...session.keywords.map(k =>
          new Paragraph({
            children: [new TextRun({ text: `• ${k.text}`, size: 24 })],
          })
        ),
        new Paragraph({ text: '' }),
        new Paragraph({ text: 'AI 分析方案', heading: HeadingLevel.HEADING_1 }),
        ...session.ideaCards.flatMap(card => [
          new Paragraph({ text: card.title, heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun({ text: card.content, size: 24 })] }),
          new Paragraph({
            children: [
              new TextRun({ text: '相关关键词：', bold: true, size: 22 }),
              new TextRun({ text: card.relatedKeywords.join('、'), size: 22 }),
            ],
          }),
          new Paragraph({ text: '' }),
        ]),
      ],
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  downloadBlob(blob, `${session.topic}-头脑风暴.docx`)
  logger.info(MOD, 'DOCX 导出完成', { bytes: buffer.byteLength })
}

export async function exportMindMapImage(elementId: string, topic: string): Promise<void> {
  logger.info(MOD, '导出思维导图 PNG', { elementId, topic })
  const el = document.getElementById(elementId)
  if (!el) {
    logger.error(MOD, `找不到元素 #${elementId}`)
    throw new Error('找不到思维导图元素')
  }
  logger.debug(MOD, '开始截图', { width: el.offsetWidth, height: el.offsetHeight })
  const dataUrl = await toPng(el, { backgroundColor: '#f0f4ff', pixelRatio: 2 })
  logger.info(MOD, 'PNG 截图完成', { dataUrlLength: dataUrl.length })
  const link = document.createElement('a')
  link.download = `${topic}-思维导图.png`
  link.href = dataUrl
  link.click()
}

function downloadBlob(blob: Blob, filename: string) {
  logger.debug(MOD, `触发下载`, { filename, bytes: blob.size })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
