import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FilePlus2,
  Files,
  GripVertical,
  HardDriveDownload,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { saveAs } from 'file-saver'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { StoredDocument } from '../types'
import type { PdfResultHandler, PdfWorkspaceResult } from './PdfWorkspaceTypes'
import './PdfWorkflow.css'

GlobalWorkerOptions.workerSrc = workerUrl

type MergeFile = {
  id: string
  file: File
  name: string
  size: number
  pageCount: number
  thumbnail: string
}

export type PdfMergeWorkspaceProps = {
  initialDocument?: StoredDocument
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

async function inspectPdf(file: File): Promise<MergeFile> {
  const bytes = await file.arrayBuffer()
  const pdf = await getDocument({ data: bytes.slice(0) }).promise
  try {
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 0.24 })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not create a PDF preview.')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    return {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      pageCount: pdf.numPages,
      thumbnail: canvas.toDataURL('image/jpeg', 0.78),
    }
  } finally {
    await pdf.cleanup()
  }
}

export function PdfMergeWorkspace({ initialDocument, onResult, onSaveToLibrary, onClose }: PdfMergeWorkspaceProps) {
  const [files, setFiles] = useState<MergeFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dragged, setDragged] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [result, setResult] = useState<PdfWorkspaceResult | null>(null)
  const [resultUrl, setResultUrl] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const initialId = useRef<string | null>(null)

  useEffect(() => {
    if (!initialDocument?.data || initialId.current === initialDocument.id) return
    initialId.current = initialDocument.id
    const file = new File([initialDocument.data], initialDocument.name, { type: 'application/pdf' })
    setLoadingFiles(true)
    void inspectPdf(file)
      .then((entry) => setFiles((current) => [entry, ...current]))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not read the PDF.'))
      .finally(() => setLoadingFiles(false))
  }, [initialDocument])

  useEffect(() => {
    if (!result) {
      setResultUrl('')
      return
    }
    const url = URL.createObjectURL(result.blob)
    setResultUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [result])

  const addFiles = async (selected: FileList | null) => {
    if (!selected?.length) return
    setLoadingFiles(true)
    setError('')
    setResult(null)
    try {
      const additions = await Promise.all(Array.from(selected).map(inspectPdf))
      setFiles((current) => [...current, ...additions])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'One of the selected PDFs could not be read.')
    } finally {
      setLoadingFiles(false)
      if (picker.current) picker.current.value = ''
    }
  }

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= files.length || to >= files.length) return
    setFiles((current) => {
      const next = [...current]
      const [entry] = next.splice(from, 1)
      next.splice(to, 0, entry)
      return next
    })
    setResult(null)
  }

  const completeDrop = (target: number) => {
    if (dragged !== null) move(dragged, target)
    setDragged(null)
    setDropTarget(null)
  }

  const remove = (id: string) => {
    setFiles((current) => current.filter((entry) => entry.id !== id))
    setResult(null)
  }

  const merge = async () => {
    if (files.length < 2) return
    setProcessing(true)
    setError('')
    setResult(null)
    try {
      const form = new FormData()
      files.forEach((entry) => form.append('files', entry.file, entry.name))
      const response = await fetch('/api/api/v1/pdf/merge', { method: 'POST', body: form })
      if (!response.ok) throw new Error(await responseError(response))
      const output: PdfWorkspaceResult = {
        blob: await response.blob(),
        filename: 'merged.pdf',
        mimeType: 'application/pdf',
      }
      setResult(output)
      await onResult?.(output)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not merge these PDFs.')
    } finally {
      setProcessing(false)
    }
  }

  const saveToLibrary = async () => {
    if (!result || !onSaveToLibrary) return
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

  const totalPages = files.reduce((sum, entry) => sum + entry.pageCount, 0)

  return <section className="pdf-workflow merge-workspace" aria-labelledby="merge-workspace-title">
    <div className="pdf-workflow-heading">
      <div>
        <span className="pdf-workflow-eyebrow"><Files /> PDF tools</span>
        <h1 id="merge-workspace-title">Merge PDF</h1>
        <p>Arrange complete files in the order they should appear, then create one PDF.</p>
      </div>
      {onClose && <button className="pdf-icon-button" onClick={onClose} aria-label="Close merge tool"><X /></button>}
    </div>

    <div className="pdf-workflow-summary" aria-live="polite">
      <span><b>{files.length}</b> {files.length === 1 ? 'file' : 'files'}</span>
      <span><b>{totalPages}</b> {totalPages === 1 ? 'page' : 'pages'}</span>
      <button onClick={() => picker.current?.click()} disabled={loadingFiles}><Plus /> Add PDFs</button>
    </div>

    {files.length === 0 && !loadingFiles
      ? <button className="pdf-drop-empty" onClick={() => picker.current?.click()}>
          <span><FilePlus2 /></span><b>Select PDF files</b><small>Choose at least two files. You can reorder them before merging.</small>
        </button>
      : <div className="merge-file-list" role="list" aria-label="Files to merge">
          {files.map((entry, index) => <article
            className={`merge-file-card${dropTarget === index ? ' is-drop-target' : ''}`}
            key={entry.id}
            role="listitem"
            draggable
            onDragStart={() => setDragged(index)}
            onDragEnd={() => { setDragged(null); setDropTarget(null) }}
            onDragOver={(event) => { event.preventDefault(); setDropTarget(index) }}
            onDrop={() => completeDrop(index)}
          >
            <div className="merge-file-order" aria-label={`Position ${index + 1}`}>{index + 1}</div>
            <GripVertical className="merge-drag-handle" aria-hidden="true" />
            <div className="merge-file-thumb"><img src={entry.thumbnail} alt="" /></div>
            <div className="merge-file-copy">
              <b title={entry.name}>{entry.name}</b>
              <span>{entry.pageCount} {entry.pageCount === 1 ? 'page' : 'pages'} · {readableSize(entry.size)}</span>
            </div>
            <div className="merge-file-actions">
              <button onClick={() => move(index, index - 1)} disabled={index === 0} aria-label={`Move ${entry.name} earlier`}><ArrowUp /></button>
              <button onClick={() => move(index, index + 1)} disabled={index === files.length - 1} aria-label={`Move ${entry.name} later`}><ArrowDown /></button>
              <button className="danger" onClick={() => remove(entry.id)} aria-label={`Remove ${entry.name}`}><Trash2 /></button>
            </div>
          </article>)}
          {loadingFiles && <div className="pdf-inline-loading"><LoaderCircle className="spin" /> Reading PDF details…</div>}
        </div>}

    <input ref={picker} hidden multiple type="file" accept="application/pdf,.pdf" onChange={(event) => void addFiles(event.target.files)} />
    {error && <div className="pdf-workflow-error" role="alert">{error}</div>}

    {result && <div className="pdf-result-panel" aria-live="polite">
      <div className="pdf-result-preview"><iframe src={`${resultUrl}#toolbar=0&navpanes=0`} title="Merged PDF preview" /></div>
      <div className="pdf-result-copy">
        <span className="pdf-result-ready"><CheckCircle2 /> Ready</span>
        <h2>Your merged PDF</h2>
        <p>{files.length} files · {totalPages} pages · {readableSize(result.blob.size)}</p>
        <div className="pdf-result-actions">
          <button className="primary" onClick={() => saveAs(result.blob, result.filename)}><Download /> Download PDF</button>
          {onSaveToLibrary && <button onClick={() => void saveToLibrary()} disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <HardDriveDownload />}{saving ? 'Saving…' : 'Save to library'}</button>}
        </div>
      </div>
    </div>}

    <footer className="pdf-workflow-submit">
      <span>{files.length < 2 ? 'Add at least two PDFs to continue.' : `${files.length} files will become one ${totalPages}-page PDF.`}</span>
      <button onClick={() => void merge()} disabled={processing || loadingFiles || files.length < 2}>
        {processing ? <LoaderCircle className="spin" /> : <Files />}{processing ? 'Merging…' : 'Merge PDF'}
      </button>
    </footer>
  </section>
}
