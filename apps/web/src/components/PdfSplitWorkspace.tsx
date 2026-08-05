import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Download,
  FileArchive,
  FileOutput,
  HardDriveDownload,
  LoaderCircle,
  Scissors,
  X,
} from 'lucide-react'
import { saveAs } from 'file-saver'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { StoredDocument } from '../types'
import type { PdfResultHandler, PdfWorkspaceResult } from './PdfWorkspaceTypes'
import './PdfWorkflow.css'

GlobalWorkerOptions.workerSrc = workerUrl

type SplitMode = 'ranges' | 'pages' | 'extract'
type SplitPage = { number: number; thumbnail: string }

export type PdfSplitWorkspaceProps = {
  document: StoredDocument
  onResult?: PdfResultHandler
  onSaveToLibrary?: PdfResultHandler
  onClose?: () => void
}

const readableSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const responseError = async (response: Response) => {
  try {
    const payload = await response.json() as { detail?: string }
    return payload.detail || 'The PDF service could not complete this request.'
  } catch {
    return 'The PDF service could not complete this request.'
  }
}

function selectedFromRange(specification: string, total: number) {
  const selected = new Set<number>()
  for (const rawToken of specification.replaceAll(' ', '').split(',')) {
    if (!rawToken) throw new Error('Remove empty page entries.')
    if (rawToken.includes('-')) {
      const values = rawToken.split('-')
      if (values.length !== 2) throw new Error(`“${rawToken}” is not a valid range.`)
      const start = Number(values[0])
      const end = Number(values[1])
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) throw new Error(`“${rawToken}” is not a valid ascending range.`)
      for (let page = start; page <= end; page += 1) selected.add(page)
    } else {
      const page = Number(rawToken)
      if (!Number.isInteger(page)) throw new Error(`“${rawToken}” is not a valid page number.`)
      selected.add(page)
    }
  }
  if (!selected.size) throw new Error('Enter at least one page or range.')
  if ([...selected].some((page) => page < 1 || page > total)) throw new Error(`Page numbers must stay between 1 and ${total}.`)
  return selected
}

function validateRangeGroups(value: string, total: number) {
  const groups = value.split(';').map((group) => group.trim()).filter(Boolean)
  if (!groups.length) throw new Error('Add at least one output range, such as 1-3; 4-6.')
  const selections = groups.map((group) => selectedFromRange(group, total))
  return { groups: groups.length, pages: selections.reduce((sum, selection) => sum + selection.size, 0) }
}

async function renderPages(source: ArrayBuffer) {
  const pdf = await getDocument({ data: source.slice(0) }).promise
  const result: SplitPage[] = []
  try {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number)
      const viewport = page.getViewport({ scale: 0.2 })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser could not create a PDF preview.')
      await page.render({ canvas, canvasContext: context, viewport }).promise
      result.push({ number, thumbnail: canvas.toDataURL('image/jpeg', 0.72) })
    }
    return result
  } finally {
    await pdf.cleanup()
  }
}

export function PdfSplitWorkspace({ document, onResult, onSaveToLibrary, onClose }: PdfSplitWorkspaceProps) {
  const [mode, setMode] = useState<SplitMode>('ranges')
  const [pages, setPages] = useState<SplitPage[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const [ranges, setRanges] = useState('1-3; 4-6')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PdfWorkspaceResult | null>(null)
  const [resultUrl, setResultUrl] = useState('')
  const rangeInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!document.data) {
      setError('This PDF is not available in local storage.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    void renderPages(document.data)
      .then((rendered) => {
        setPages(rendered)
        setRanges(rendered.length >= 6 ? '1-3; 4-6' : `1-${Math.max(1, rendered.length)}`)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not render this PDF.'))
      .finally(() => setLoading(false))
  }, [document])

  useEffect(() => {
    if (!result || result.mimeType !== 'application/pdf') {
      setResultUrl('')
      return
    }
    const url = URL.createObjectURL(result.blob)
    setResultUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [result])

  const chooseMode = (next: SplitMode) => {
    setMode(next)
    setError('')
    setResult(null)
    if (next === 'ranges') window.setTimeout(() => rangeInput.current?.focus(), 0)
  }

  const togglePage = (number: number, shiftKey: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (shiftKey && anchor !== null) {
        const [start, end] = [anchor, number].sort((a, b) => a - b)
        for (let page = start; page <= end; page += 1) next.add(page)
      } else if (next.has(number)) next.delete(number)
      else next.add(number)
      return next
    })
    setAnchor(number)
    setResult(null)
  }

  const processPdf = async () => {
    if (!document.data || !pages.length) return
    setProcessing(true)
    setError('')
    setResult(null)
    try {
      let endpoint = '/api/api/v1/pdf/split'
      let outputName = `${document.name.replace(/\.pdf$/i, '')}-split.zip`
      let mimeType: PdfWorkspaceResult['mimeType'] = 'application/zip'
      const form = new FormData()
      form.append('file', new File([document.data], document.name, { type: 'application/pdf' }))
      if (mode === 'extract') {
        if (!selected.size) throw new Error('Select at least one page to extract.')
        endpoint = '/api/api/v1/pdf/extract'
        outputName = `${document.name.replace(/\.pdf$/i, '')}-extracted.pdf`
        mimeType = 'application/pdf'
        form.append('pages', [...selected].sort((a, b) => a - b).join(','))
      } else if (mode === 'pages') {
        form.append('mode', 'pages')
      } else {
        validateRangeGroups(ranges, pages.length)
        form.append('mode', 'ranges')
        form.append('ranges', ranges)
      }
      const response = await fetch(endpoint, { method: 'POST', body: form })
      if (!response.ok) throw new Error(await responseError(response))
      const output: PdfWorkspaceResult = { blob: await response.blob(), filename: outputName, mimeType }
      setResult(output)
      await onResult?.(output)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not split this PDF.')
    } finally {
      setProcessing(false)
    }
  }

  const saveToLibrary = async () => {
    if (!result || !onSaveToLibrary || result.mimeType !== 'application/pdf') return
    setSaving(true)
    setError('')
    try {
      await onSaveToLibrary(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this PDF to your library.')
    } finally {
      setSaving(false)
    }
  }

  let rangeSummary = ''
  if (mode === 'ranges' && pages.length) {
    try {
      const summary = validateRangeGroups(ranges, pages.length)
      rangeSummary = `${summary.groups} output files · ${summary.pages} total selected pages`
    } catch {
      rangeSummary = 'Use commas within a part and semicolons between output files.'
    }
  }

  return <section className="pdf-workflow split-workspace" aria-labelledby="split-workspace-title">
    <div className="pdf-workflow-heading">
      <div>
        <span className="pdf-workflow-eyebrow"><Scissors /> PDF tools</span>
        <h1 id="split-workspace-title">Split PDF</h1>
        <p>Separate a document into individual pages, custom ranges, or one extracted PDF.</p>
      </div>
      {onClose && <button className="pdf-icon-button" onClick={onClose} aria-label="Close split tool"><X /></button>}
    </div>

    <div className="split-layout">
      <aside className="split-controls">
        <div className="split-source"><FileOutput /><div><b>{document.name}</b><span>{pages.length || '—'} pages · {readableSize(document.size)}</span></div></div>
        <div className="split-mode-tabs" role="tablist" aria-label="Split method">
          <button role="tab" aria-selected={mode === 'ranges'} className={mode === 'ranges' ? 'active' : ''} onClick={() => chooseMode('ranges')}>Custom ranges</button>
          <button role="tab" aria-selected={mode === 'pages'} className={mode === 'pages' ? 'active' : ''} onClick={() => chooseMode('pages')}>Every page</button>
          <button role="tab" aria-selected={mode === 'extract'} className={mode === 'extract' ? 'active' : ''} onClick={() => chooseMode('extract')}>Extract pages</button>
        </div>
        {mode === 'ranges' && <div className="split-range-form">
          <label htmlFor="split-ranges">Output ranges</label>
          <input ref={rangeInput} id="split-ranges" value={ranges} onChange={(event) => { setRanges(event.target.value); setResult(null) }} placeholder="1-3; 4-6; 7,9" />
          <small>{rangeSummary}</small>
          <div className="range-example"><b>Example</b><span><code>1-3; 4-6</code> creates two PDFs.</span></div>
        </div>}
        {mode === 'pages' && <div className="split-mode-note"><FileArchive /><div><b>{pages.length} PDF files</b><span>Each page will be saved as its own PDF in one ZIP archive.</span></div></div>}
        {mode === 'extract' && <div className="split-mode-note"><Check /><div><b>{selected.size} pages selected</b><span>Click thumbnails to choose pages. Hold Shift to select a range.</span></div></div>}
      </aside>

      <div className="split-page-area">
        <div className="split-page-toolbar">
          <span>Document pages</span>
          {mode === 'extract' && <div>
            <button onClick={() => setSelected(new Set(pages.map((page) => page.number)))}>Select all</button>
            <button onClick={() => setSelected(new Set())}>Clear</button>
          </div>}
        </div>
        {loading
          ? <div className="pdf-canvas-loading"><LoaderCircle className="spin" /><b>Preparing page previews…</b></div>
          : <div className={`split-page-grid${mode === 'extract' ? ' is-selectable' : ''}`}>
              {pages.map((page) => <button
                key={page.number}
                className={selected.has(page.number) ? 'selected' : ''}
                onClick={(event) => mode === 'extract' && togglePage(page.number, event.shiftKey)}
                disabled={mode !== 'extract'}
                aria-pressed={mode === 'extract' ? selected.has(page.number) : undefined}
                aria-label={`Page ${page.number}${selected.has(page.number) ? ', selected' : ''}`}
              >
                <span className="split-page-check"><Check /></span>
                <img src={page.thumbnail} alt="" />
                <b>Page {page.number}</b>
              </button>)}
            </div>}
      </div>
    </div>

    {error && <div className="pdf-workflow-error" role="alert">{error}</div>}

    {result && <div className="pdf-result-panel" aria-live="polite">
      {result.mimeType === 'application/pdf'
        ? <div className="pdf-result-preview"><iframe src={`${resultUrl}#toolbar=0&navpanes=0`} title="Extracted PDF preview" /></div>
        : <div className="pdf-result-archive"><FileArchive /><span>{mode === 'pages' ? pages.length : validateRangeGroups(ranges, pages.length).groups} files</span></div>}
      <div className="pdf-result-copy">
        <span className="pdf-result-ready"><CheckCircle2 /> Ready</span>
        <h2>{result.mimeType === 'application/pdf' ? 'Your extracted PDF' : 'Your split PDFs'}</h2>
        <p>{result.filename} · {readableSize(result.blob.size)}</p>
        <div className="pdf-result-actions">
          <button className="primary" onClick={() => saveAs(result.blob, result.filename)}><Download /> Download {result.mimeType === 'application/pdf' ? 'PDF' : 'ZIP'}</button>
          {onSaveToLibrary && result.mimeType === 'application/pdf' && <button onClick={() => void saveToLibrary()} disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <HardDriveDownload />}{saving ? 'Saving…' : 'Save to library'}</button>}
        </div>
      </div>
    </div>}

    <footer className="pdf-workflow-submit">
      <span>{mode === 'extract' ? `${selected.size} selected ${selected.size === 1 ? 'page' : 'pages'}` : mode === 'pages' ? `${pages.length} individual PDFs` : rangeSummary}</span>
      <button onClick={() => void processPdf()} disabled={loading || processing || !pages.length || (mode === 'extract' && !selected.size)}>
        {processing ? <LoaderCircle className="spin" /> : mode === 'extract' ? <FileOutput /> : <Scissors />}{processing ? 'Processing…' : mode === 'extract' ? 'Extract pages' : 'Split PDF'}
      </button>
    </footer>
  </section>
}
