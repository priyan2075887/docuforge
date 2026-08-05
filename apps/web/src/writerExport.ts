import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, type IParagraphOptions } from 'docx'

function runs(node: Node, inherited: Record<string, unknown> = {}): TextRun[] {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [new TextRun({ text: node.textContent, ...inherited })] : []
  if (!(node instanceof HTMLElement)) return []
  const style = { ...inherited } as Record<string, unknown>
  if (['STRONG','B'].includes(node.tagName)) style.bold = true
  if (['EM','I'].includes(node.tagName)) style.italics = true
  if (node.tagName === 'U') style.underline = {}
  if (['S','STRIKE'].includes(node.tagName)) style.strike = true
  if (node.tagName === 'SUP') style.superScript = true
  if (node.tagName === 'SUB') style.subScript = true
  if (node.style.color) style.color = node.style.color.replace('#','')
  if (node.style.fontFamily) style.font = node.style.fontFamily.replace(/["']/g,'')
  if (node.style.fontSize) style.size = Math.round(Number.parseFloat(node.style.fontSize) * 1.5)
  if (node.tagName === 'A') { style.color = '315DCC'; style.underline = {} }
  if (node.tagName === 'BR') return [new TextRun({ break: 1 })]
  return Array.from(node.childNodes).flatMap((child) => runs(child, style))
}

function paragraph(element: HTMLElement, options: IParagraphOptions = {}): Paragraph {
  const alignment = ({ center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as Record<string,string>)[element.style.textAlign]
  return new Paragraph({ ...options, alignment: alignment as typeof AlignmentType.CENTER | undefined, children: runs(element) })
}

function blocks(root: HTMLElement): (Paragraph | Table)[] {
  const output: (Paragraph | Table)[] = []
  for (const node of Array.from(root.children) as HTMLElement[]) {
    if (/^H[1-3]$/.test(node.tagName)) output.push(paragraph(node, { heading: node.tagName === 'H1' ? HeadingLevel.HEADING_1 : node.tagName === 'H2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3 }))
    else if (node.tagName === 'P' || node.tagName === 'BLOCKQUOTE' || node.tagName === 'PRE') output.push(paragraph(node, node.tagName === 'BLOCKQUOTE' ? { indent: { left: 500 } } : {}))
    else if (node.tagName === 'UL' || node.tagName === 'OL') Array.from(node.children).forEach((item) => output.push(paragraph(item as HTMLElement, node.tagName === 'UL' ? { bullet: { level: 0 } } : { numbering: { reference: 'default-numbering', level: 0 } })))
    else if (node.tagName === 'TABLE') output.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: Array.from(node.querySelectorAll(':scope > tbody > tr, :scope > thead > tr')).map((row) => new TableRow({ children: Array.from(row.children).map((cell) => new TableCell({ children: [paragraph(cell as HTMLElement)] })) })) }))
    else if (node.tagName === 'HR') output.push(new Paragraph({ border: { bottom: { color: '999999', size: 6, style: 'single' as any, space: 1 } } }))
    else output.push(...blocks(node))
  }
  return output.length ? output : [new Paragraph('')]
}

export async function exportWriterDocx(html: string): Promise<Blob> {
  const root = new DOMParser().parseFromString(html, 'text/html').body
  const document = new Document({ numbering: { config: [{ reference: 'default-numbering', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }] }, sections: [{ properties: {}, children: blocks(root) }] })
  return Packer.toBlob(document)
}
