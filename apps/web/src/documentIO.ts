import type { DocumentKind, Slide, StoredDocument } from './types'

const extension = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

export function documentKind(file: File): DocumentKind | null {
  const ext = extension(file.name)
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (file.type.startsWith('image/')) return 'image'
  if (['docx', 'doc', 'odt', 'txt', 'md', 'html'].includes(ext)) return 'writer'
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'sheet'
  if (['pptx', 'ppt', 'odp'].includes(ext)) return 'slides'
  return null
}

export async function importFile(file: File): Promise<StoredDocument> {
  const kind = documentKind(file)
  if (!kind) throw new Error(`Unsupported file type: ${file.name}`)
  const data = await file.arrayBuffer()
  let content: string | undefined
  const ext = extension(file.name)

  if (kind === 'writer') {
    if (ext === 'docx') {
      const mammoth = (await import('mammoth')).default
      content = (await mammoth.convertToHtml({ arrayBuffer: data })).value
    }
    else if (['txt', 'md'].includes(ext)) content = `<p>${escapeHtml(new TextDecoder().decode(data)).replace(/\n/g, '</p><p>')}</p>`
    else if (ext === 'html') content = new TextDecoder().decode(data)
    else content = '<p>This legacy document is stored safely, but editable import requires conversion to DOCX or ODT.</p>'
  }
  if (kind === 'sheet') {
    if (ext === 'csv') {
      const rows = new TextDecoder().decode(data).split(/\r?\n/).map((line) => line.split(','))
      content = JSON.stringify([{ name: 'Sheet1', rows }])
    } else {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data)
      content = JSON.stringify(workbook.worksheets.map((sheet) => ({ name: sheet.name, rows: Array.from({ length: sheet.rowCount }, (_, index) => { const values = sheet.getRow(index + 1).values; return (Array.isArray(values) ? values.slice(1) : []).map((value) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value) }) })))
    }
  }
  if (kind === 'slides') {
    const slides: Slide[] = [{ id: crypto.randomUUID(), title: file.name, body: 'The original presentation is stored locally. Full-fidelity PPTX import is the next interoperability milestone.', background: '#ffffff' }]
    content = JSON.stringify(slides)
  }

  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), name: file.name, kind, mimeType: file.type || 'application/octet-stream', size: file.size, createdAt: now, updatedAt: now, data, content }
}

export function createDocument(kind: Extract<DocumentKind, 'writer' | 'sheet' | 'slides'>): StoredDocument {
  const now = new Date().toISOString()
  const names = { writer: 'Untitled document.docx', sheet: 'Untitled spreadsheet.xlsx', slides: 'Untitled presentation.pptx' }
  const content = kind === 'writer' ? '<h1>Untitled document</h1><p>Start writing here…</p>' : kind === 'sheet' ? JSON.stringify([{ name: 'Sheet1', rows: [['', '', ''], ['', '', '']] }]) : JSON.stringify([{ id: crypto.randomUUID(), title: 'Untitled presentation', body: 'Add your subtitle', background: '#ffffff' }])
  return { id: crypto.randomUUID(), name: names[kind], kind, mimeType: '', size: 0, createdAt: now, updatedAt: now, content }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]!))
}
