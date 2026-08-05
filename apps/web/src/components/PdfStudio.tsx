import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRightToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FilePlus2,
  Files,
  GripVertical,
  HardDriveDownload,
  Layers3,
  LoaderCircle,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Scissors,
  Shuffle,
  SquareDashed,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { saveAs } from 'file-saver'
import type { StoredDocument } from '../types'
import type { PdfWorkspaceResult } from './PdfWorkspaceTypes'
import {
  usePdfOrganizerState,
  type PdfDropEdge,
  type PdfOrganizerPage,
  type PdfOrganizerSource,
} from './pdfOrganizerState'
import './PdfStudio.css'

GlobalWorkerOptions.workerSrc = workerUrl

const PdfMergeWorkspace = lazy(() => import('./PdfMergeWorkspace').then((module) => ({ default: module.PdfMergeWorkspace })))
const PdfSplitWorkspace = lazy(() => import('./PdfSplitWorkspace').then((module) => ({ default: module.PdfSplitWorkspace })))

const EMPTY_PAGES: PdfOrganizerPage[] = []
const SOURCE_COLORS = ['#e5322d', '#4477d4', '#118b6b', '#9454c6', '#d17b16', '#167e9a', '#cf4d86', '#5e6d35']

type StudioMode = 'organize' | 'merge' | 'split'
type StudioSource = PdfOrganizerSource & { file: File }
type DropTarget = { id: string; edge: PdfDropEdge }
type OrganizerResult = { blob: Blob; filename: string }

export type PdfStudioProps = {
  document: StoredDocument
  back: () => void
  notify: (text: string) => void
  saveToLibrary?: (blob: Blob, name: string) => Promise<void>
  initialMode?: StudioMode
  onModeChange?: (mode: StudioMode) => void
}

async function readResponseError(response: Response) {
  try {
    const payload = await response.json() as { detail?: string | { message?: string } }
    if (typeof payload.detail === 'string') return payload.detail
    if (payload.detail?.message) return payload.detail.message
  } catch {
    // The generic error below is more useful than a JSON parsing error.
  }
  return `The PDF service could not complete this request (HTTP ${response.status}).`
}

async function openSource(file: File, color: string) {
  const bytes = await file.arrayBuffer()
  const pdf = await getDocument({ data: bytes.slice(0) }).promise
  const source: StudioSource = {
    id: crypto.randomUUID(),
    name: file.name,
    color,
    pageCount: pdf.numPages,
    file,
  }
  const pages: PdfOrganizerPage[] = Array.from({ length: pdf.numPages }, (_, index) => ({
    id: crypto.randomUUID(),
    kind: 'pdf',
    sourceId: source.id,
    sourcePage: index + 1,
    rotation: 0,
  }))
  return { source, pages, pdf }
}

function outputName(name: string) {
  return `${name.replace(/\.pdf$/i, '')}-organized.pdf`
}

export function PdfStudio({ document, back, notify, saveToLibrary, initialMode = 'organize', onModeChange }: PdfStudioProps) {
  const organizer = usePdfOrganizerState(EMPTY_PAGES, { historyLimit: 100 })
  const resetOrganizer = organizer.reset
  const [mode, setMode] = useState<StudioMode>(initialMode)
  const [sources, setSources] = useState<StudioSource[]>([])
  const [loading, setLoading] = useState(true)
  const [addingFiles, setAddingFiles] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(154)
  const [selectionMenu, setSelectionMenu] = useState(false)
  const [mixPanel, setMixPanel] = useState(false)
  const [mixFirst, setMixFirst] = useState('')
  const [mixSecond, setMixSecond] = useState('')
  const [mixStart, setMixStart] = useState<'first' | 'second'>('first')
  const [reverseFirst, setReverseFirst] = useState(false)
  const [reverseSecond, setReverseSecond] = useState(false)
  const [result, setResult] = useState<OrganizerResult | null>(null)
  const [resultUrl, setResultUrl] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const pdfDocuments = useRef(new Map<string, PDFDocumentProxy>())
  const thumbnailJobs = useRef(new Map<string, Promise<string>>())
  const thumbnailValues = useRef(new Map<string, string>())
  const [thumbnailVersion, setThumbnailVersion] = useState(0)
  const baselinePages = useRef<PdfOrganizerPage[]>([])

  useEffect(() => { setMode(initialMode) }, [initialMode])

  useEffect(() => {
    let cancelled = false
    const loadInitialDocument = async () => {
      setLoading(true)
      setError('')
      setResult(null)
      for (const pdf of pdfDocuments.current.values()) void pdf.cleanup()
      pdfDocuments.current.clear()
      thumbnailJobs.current.clear()
      thumbnailValues.current.clear()
      setThumbnailVersion((value) => value + 1)
      try {
        if (!document.data) throw new Error('This PDF is not available in local storage.')
        const file = new File([document.data], document.name, { type: 'application/pdf' })
        const loaded = await openSource(file, SOURCE_COLORS[0])
        if (cancelled) { void loaded.pdf.cleanup(); return }
        pdfDocuments.current.set(loaded.source.id, loaded.pdf)
        setSources([loaded.source])
        baselinePages.current = loaded.pages
        resetOrganizer(loaded.pages)
        setMixFirst(loaded.source.id)
        setMixSecond('')
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not open this PDF.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadInitialDocument()
    return () => { cancelled = true }
  }, [document.data, document.id, document.name, resetOrganizer])

  useEffect(() => () => {
    for (const pdf of pdfDocuments.current.values()) void pdf.cleanup()
    pdfDocuments.current.clear()
  }, [])

  useEffect(() => {
    setResult(null)
  }, [organizer.pages])

  useEffect(() => {
    if (!result) { setResultUrl(''); return }
    const url = URL.createObjectURL(result.blob)
    setResultUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [result])

  useEffect(() => {
    if (!mixFirst && sources[0]) setMixFirst(sources[0].id)
    if ((!mixSecond || mixSecond === mixFirst) && sources.length > 1) {
      setMixSecond(sources.find((source) => source.id !== mixFirst)?.id ?? '')
    }
  }, [mixFirst, mixSecond, sources])

  useEffect(() => {
    if (mode !== 'organize') return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input,select,textarea,[contenteditable="true"]')) return
      const command = event.ctrlKey || event.metaKey
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) organizer.redo()
        else organizer.undo()
        return
      }
      if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); organizer.redo(); return }
      if (command && event.key.toLowerCase() === 'a') { event.preventDefault(); organizer.selectAll(); return }
      if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); organizer.duplicateSelected(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (organizer.selectedIds.size) { event.preventDefault(); organizer.deleteSelected() }
        return
      }
      if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); organizer.moveSelected('backward'); return }
      if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); organizer.moveSelected('forward'); return }
      if (event.key === 'Escape') { organizer.clearSelection(); setSelectionMenu(false); setMixPanel(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, organizer])

  const changeMode = (next: StudioMode) => {
    setMode(next)
    setError('')
    onModeChange?.(next)
  }

  const addPdfs = async (files: FileList | null) => {
    if (!files?.length) return
    if (sources.length + files.length > 50) { setError('An organizer session can contain up to 50 source PDFs.'); return }
    setAddingFiles(true)
    setError('')
    const loaded: Awaited<ReturnType<typeof openSource>>[] = []
    try {
      for (const [index, file] of Array.from(files).entries()) {
        if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') throw new Error(`${file.name} is not a PDF.`)
        loaded.push(await openSource(file, SOURCE_COLORS[(sources.length + index) % SOURCE_COLORS.length]))
      }
      for (const entry of loaded) pdfDocuments.current.set(entry.source.id, entry.pdf)
      const addedSources = loaded.map((entry) => entry.source)
      const addedPages = loaded.flatMap((entry) => entry.pages)
      setSources((current) => [...current, ...addedSources])
      baselinePages.current = [...baselinePages.current, ...addedPages]
      organizer.appendPages(addedPages, true)
      if (!mixSecond && addedSources[0]) setMixSecond(addedSources[0].id)
      notify(`${files.length} PDF${files.length === 1 ? '' : 's'} added`)
    } catch (reason) {
      for (const entry of loaded) void entry.pdf.cleanup()
      setError(reason instanceof Error ? reason.message : 'One of the selected PDFs could not be read.')
    } finally {
      setAddingFiles(false)
      if (picker.current) picker.current.value = ''
    }
  }

  const requestThumbnail = useCallback((page: PdfOrganizerPage) => {
    if (page.kind === 'blank' || !page.sourceId || !page.sourcePage) return
    const key = `${page.sourceId}:${page.sourcePage}`
    if (thumbnailValues.current.has(key) || thumbnailJobs.current.has(key)) return
    const pdf = pdfDocuments.current.get(page.sourceId)
    if (!pdf) return
    const job = (async () => {
      const sourcePage = await pdf.getPage(page.sourcePage!)
      const natural = sourcePage.getViewport({ scale: 1 })
      const scale = Math.min(0.48, 230 / natural.width)
      const viewport = sourcePage.getViewport({ scale })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser could not render PDF thumbnails.')
      await sourcePage.render({ canvas, canvasContext: context, viewport }).promise
      return canvas.toDataURL('image/jpeg', 0.8)
    })()
    thumbnailJobs.current.set(key, job)
    void job.then((thumbnail) => {
      thumbnailValues.current.set(key, thumbnail)
      setThumbnailVersion((value) => value + 1)
    }).catch(() => undefined).finally(() => thumbnailJobs.current.delete(key))
  }, [])

  const compose = async () => {
    if (!organizer.pages.length || !sources.length) return
    setProcessing(true)
    setError('')
    try {
      const sourceIndexes = new Map(sources.map((source, index) => [source.id, index]))
      const manifest = organizer.pages.map((page) => {
        if (page.kind === 'blank') return { blank: { width: page.width ?? 595, height: page.height ?? 842 }, rotation: page.rotation }
        const source = page.sourceId ? sourceIndexes.get(page.sourceId) : undefined
        if (source === undefined || page.sourcePage === null) throw new Error('A source page is no longer available. Undo the removal or add the PDF again.')
        return { source, page: page.sourcePage, rotation: page.rotation }
      })
      const form = new FormData()
      sources.forEach((source) => form.append('files', source.file, source.name))
      form.append('manifest', JSON.stringify({ pages: manifest }))
      const response = await fetch('/api/api/v1/pdf/compose', { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readResponseError(response))
      setResult({ blob: await response.blob(), filename: outputName(document.name) })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not organize this PDF.')
    } finally {
      setProcessing(false)
    }
  }

  const saveOrganizerResult = async () => {
    if (!result || !saveToLibrary) return
    setSaving(true)
    setError('')
    try { await saveToLibrary(result.blob, result.filename) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this PDF to My files.') }
    finally { setSaving(false) }
  }

  const saveWorkflowResult = async (workspaceResult: PdfWorkspaceResult) => {
    if (!saveToLibrary || workspaceResult.mimeType !== 'application/pdf') return
    await saveToLibrary(workspaceResult.blob, workspaceResult.filename)
  }

  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const selectedCount = organizer.selectedIds.size
  const usedPageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    organizer.pages.forEach((page) => { if (page.sourceId) counts.set(page.sourceId, (counts.get(page.sourceId) ?? 0) + 1) })
    return counts
  }, [organizer.pages])

  return <div className="pdf-studio-shell">
    <header className="pdf-tools-header">
      <button onClick={back} className="pdf-tools-back" aria-label="Back to document"><ArrowLeft /></button>
      <div className="pdf-tools-brand"><span>D</span><b>DocuForge</b></div>
      <nav aria-label="PDF tools">
        <button className={mode === 'organize' ? 'active' : ''} onClick={() => changeMode('organize')}><Layers3 />Organize</button>
        <button className={mode === 'merge' ? 'active' : ''} onClick={() => changeMode('merge')}><Files />Merge</button>
        <button className={mode === 'split' ? 'active' : ''} onClick={() => changeMode('split')}><Scissors />Split</button>
      </nav>
      <button className="download-original" onClick={() => document.data && saveAs(new Blob([document.data], { type: 'application/pdf' }), document.name)}><Download />Original</button>
    </header>

    {mode === 'merge' && <Suspense fallback={<PdfToolLoading label="Opening merge tool"/>}><PdfMergeWorkspace initialDocument={document} onSaveToLibrary={saveToLibrary ? saveWorkflowResult : undefined}/></Suspense>}
    {mode === 'split' && <Suspense fallback={<PdfToolLoading label="Opening split tool"/>}><PdfSplitWorkspace document={document} onSaveToLibrary={saveToLibrary ? saveWorkflowResult : undefined}/></Suspense>}
    {mode === 'organize' && <div className="organizer">
      <div className="organizer-title"><div><span>PDF organizer</span><h1>Organize PDF</h1><p>Reorder, rotate, remove and combine pages.</p></div><button onClick={() => picker.current?.click()} disabled={addingFiles}><Plus />Add PDFs</button></div>

      <div className="organizer-toolbar" role="toolbar" aria-label="Page actions">
        <div className="tool-group history-tools">
          <button title="Undo (Ctrl/Cmd+Z)" disabled={!organizer.canUndo} onClick={organizer.undo}><Undo2/><span>Undo</span></button>
          <button title="Redo (Ctrl/Cmd+Y)" disabled={!organizer.canRedo} onClick={organizer.redo}><Redo2/><span>Redo</span></button>
        </div>
        <div className="tool-divider" />
        <div className="tool-popover-wrap">
          <button className={selectedCount ? 'is-active' : ''} aria-expanded={selectionMenu} onClick={() => { setSelectionMenu(!selectionMenu); setMixPanel(false) }}><Check />{selectedCount ? `${selectedCount} selected` : 'Select'}<ChevronDown /></button>
          {selectionMenu && <div className="tool-popover selection-popover">
            <button onClick={() => { organizer.selectAll(); setSelectionMenu(false) }}>All pages <kbd>Ctrl A</kbd></button>
            <button onClick={() => { organizer.selectOdd(); setSelectionMenu(false) }}>Odd pages</button>
            <button onClick={() => { organizer.selectEven(); setSelectionMenu(false) }}>Even pages</button>
            <button disabled={!selectedCount} onClick={() => { organizer.clearSelection(); setSelectionMenu(false) }}>Clear selection <kbd>Esc</kbd></button>
          </div>}
        </div>
        <div className="tool-group page-tools">
          <button title="Rotate selected left" disabled={!selectedCount} onClick={() => organizer.rotateSelected(-90)}><RotateCcw/><span>Left</span></button>
          <button title="Rotate selected right" disabled={!selectedCount} onClick={() => organizer.rotateSelected(90)}><RotateCw/><span>Right</span></button>
          <button title="Duplicate selected (Ctrl/Cmd+D)" disabled={!selectedCount} onClick={organizer.duplicateSelected}><Copy/><span>Duplicate</span></button>
          <button className="danger" title="Delete selected" disabled={!selectedCount} onClick={organizer.deleteSelected}><Trash2/><span>Delete</span></button>
        </div>
        <div className="tool-divider" />
        <div className="tool-group arrange-tools">
          <button title="Move selected backward (Alt+Left)" disabled={!selectedCount} onClick={() => organizer.moveSelected('backward')}><ArrowLeftToLine/></button>
          <button title="Move selected forward (Alt+Right)" disabled={!selectedCount} onClick={() => organizer.moveSelected('forward')}><ArrowRightToLine/></button>
          <button title="Reverse selected positions" disabled={selectedCount < 2} onClick={organizer.reverseSelected}><ArrowDownUp/><span>Reverse</span></button>
          <button title="Insert a blank page after the selection" onClick={() => {
            const lastSelected = organizer.pages.reduce((last, page, index) => organizer.selectedIds.has(page.id) ? index : last, -1)
            organizer.insertBlank(lastSelected >= 0 ? lastSelected + 1 : organizer.pages.length)
          }}><SquareDashed/><span>Blank page</span></button>
        </div>
        <div className="tool-popover-wrap">
          <button disabled={sources.length < 2} aria-expanded={mixPanel} onClick={() => { setMixPanel(!mixPanel); setSelectionMenu(false) }}><Shuffle/>Alternate mix</button>
          {mixPanel && <div className="tool-popover mix-popover">
            <label>First source<select value={mixFirst} onChange={(event) => { setMixFirst(event.target.value); if (event.target.value === mixSecond) setMixSecond(sources.find((source) => source.id !== event.target.value)?.id ?? '') }}>{sources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}</select></label>
            <label>Second source<select value={mixSecond} onChange={(event) => setMixSecond(event.target.value)}>{sources.filter((source) => source.id !== mixFirst).map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}</select></label>
            <label>Start with<select value={mixStart} onChange={(event) => setMixStart(event.target.value as 'first' | 'second')}><option value="first">First source</option><option value="second">Second source</option></select></label>
            <label className="check-row"><input type="checkbox" checked={reverseFirst} onChange={(event) => setReverseFirst(event.target.checked)}/>Reverse first source</label>
            <label className="check-row"><input type="checkbox" checked={reverseSecond} onChange={(event) => setReverseSecond(event.target.checked)}/>Reverse second source</label>
            <button className="apply-mix" disabled={!mixFirst || !mixSecond || mixFirst === mixSecond} onClick={() => { organizer.alternateMix(mixFirst, mixSecond, { startWith: mixStart, reverseFirst, reverseSecond }); setMixPanel(false) }}>Apply alternating order</button>
          </div>}
        </div>
        <div className="zoom-tools">
          <button aria-label="Smaller thumbnails" onClick={() => setZoom((value) => Math.max(108, value - 12))}><ZoomOut/></button>
          <input aria-label="Thumbnail size" type="range" min="108" max="220" step="2" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}/>
          <button aria-label="Larger thumbnails" onClick={() => setZoom((value) => Math.min(220, value + 12))}><ZoomIn/></button>
        </div>
      </div>

      <div className="organizer-workspace">
        <aside className="source-panel">
          <div className="source-panel-heading"><span>Source files</span><b>{sources.length}</b></div>
          <div className="source-list">{sources.map((source) => <div className="source-item" key={source.id}>
            <i style={{ background: source.color }}/><div><b title={source.name}>{source.name}</b><span>{source.pageCount} pages · {usedPageCounts.get(source.id) ?? 0} in output</span></div>
          </div>)}</div>
          <button className="source-add" onClick={() => picker.current?.click()} disabled={addingFiles}>{addingFiles ? <LoaderCircle className="spin"/> : <Plus/>}{addingFiles ? 'Reading PDFs…' : 'Add PDF files'}</button>
          <div className="source-help"><GripVertical/><span>Drag pages to reorder. Hold Shift for a range and Ctrl/Cmd to select several.</span></div>
        </aside>

        <VirtualPageGrid
          pages={organizer.pages}
          sources={sourceMap}
          selectedIds={organizer.selectedIds}
          zoom={zoom}
          loading={loading}
          thumbnailVersion={thumbnailVersion}
          thumbnailFor={(page) => page.sourceId && page.sourcePage ? thumbnailValues.current.get(`${page.sourceId}:${page.sourcePage}`) : undefined}
          requestThumbnail={requestThumbnail}
          selectPage={organizer.selectPage}
          clearSelection={organizer.clearSelection}
          rotateSelected={organizer.rotateSelected}
          deleteSelected={organizer.deleteSelected}
          duplicateSelected={organizer.duplicateSelected}
          insertBlank={organizer.insertBlank}
          reorderByDrag={organizer.reorderByDrag}
        />
      </div>

      <input ref={picker} hidden multiple type="file" accept="application/pdf,.pdf" onChange={(event) => void addPdfs(event.target.files)}/>
      {error && <div className="organizer-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X/></button></div>}
      <div className="organizer-submit">
        <div><b>{organizer.pages.length} {organizer.pages.length === 1 ? 'page' : 'pages'}</b><span>{sources.length} source {sources.length === 1 ? 'file' : 'files'}{selectedCount ? ` · ${selectedCount} selected` : ''}</span></div>
        <button className="reset-session" disabled={loading} onClick={() => organizer.reset(baselinePages.current)}>Reset</button>
        <button className="compose-button" disabled={processing || loading || !organizer.pages.length} onClick={() => void compose()}>{processing ? <LoaderCircle className="spin"/> : <FilePlus2/>}{processing ? 'Organizing…' : 'Organize PDF'}</button>
      </div>

      {result && <div className="organizer-result-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResult(null) }}>
        <section className="organizer-result-dialog" role="dialog" aria-modal="true" aria-labelledby="organizer-result-title">
          <button className="result-close" onClick={() => setResult(null)} aria-label="Close result"><X/></button>
          <div className="organizer-result-preview"><iframe title="Organized PDF" src={`${resultUrl}#toolbar=0&navpanes=0`}/></div>
          <div className="organizer-result-details"><span><CheckCircle2/>Ready</span><h2 id="organizer-result-title">Your PDF is ready</h2><p>{result.filename}<br/>{organizer.pages.length} pages · {formatBytes(result.blob.size)}</p>
            <button className="result-download" onClick={() => saveAs(result.blob, result.filename)}><Download/>Download PDF</button>
            {saveToLibrary && <button className="result-save" disabled={saving} onClick={() => void saveOrganizerResult()}>{saving ? <LoaderCircle className="spin"/> : <HardDriveDownload/>}{saving ? 'Saving…' : 'Save to My files'}</button>}
            <button className="result-return" onClick={() => setResult(null)}>Back to organizer</button>
          </div>
        </section>
      </div>}
    </div>}
  </div>
}

type VirtualPageGridProps = {
  pages: PdfOrganizerPage[]
  sources: Map<string, StudioSource>
  selectedIds: Set<string>
  zoom: number
  loading: boolean
  thumbnailVersion: number
  thumbnailFor: (page: PdfOrganizerPage) => string | undefined
  requestThumbnail: (page: PdfOrganizerPage) => void
  selectPage: (id: string, gesture?: { toggle?: boolean; range?: boolean }) => void
  clearSelection: () => void
  rotateSelected: (degrees: number) => void
  deleteSelected: () => void
  duplicateSelected: () => void
  insertBlank: (index: number) => void
  reorderByDrag: (draggedId: string, targetId: string, edge?: PdfDropEdge) => void
}

function VirtualPageGrid({ pages, sources, selectedIds, zoom, loading, thumbnailVersion, thumbnailFor, requestThumbnail, selectPage, clearSelection, rotateSelected, deleteSelected, duplicateSelected, insertBlank, reorderByDrag }: VirtualPageGridProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 900, height: 560 })
  const [scrollTop, setScrollTop] = useState(0)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const gap = 18
  const padding = 22
  const columns = Math.max(1, Math.floor((size.width - padding * 2 + gap) / (zoom + gap)))
  const usedWidth = columns * zoom + (columns - 1) * gap
  const leftPadding = Math.max(padding, (size.width - usedWidth) / 2)
  const cardHeight = Math.round(zoom * 1.414 + 47)
  const rowHeight = cardHeight + gap
  const rowCount = Math.ceil(pages.length / columns)
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 3)
  const endRow = Math.min(rowCount, Math.ceil((scrollTop + size.height) / rowHeight) + 3)
  const visiblePages = pages.slice(startRow * columns, endRow * columns)

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const actOnPage = (id: string, action: () => void) => {
    if (!selectedIds.has(id)) selectPage(id)
    action()
  }

  const onCanvasDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const element = viewport.current
    if (!element) return
    const bounds = element.getBoundingClientRect()
    if (event.clientY < bounds.top + 56) element.scrollTop -= 18
    else if (event.clientY > bounds.bottom - 56) element.scrollTop += 18
  }

  if (loading) return <div className="page-canvas canvas-state"><LoaderCircle className="spin"/><b>Preparing pages…</b><span>Large files open progressively.</span></div>
  if (!pages.length) return <div className="page-canvas canvas-state"><SquareDashed/><b>No pages in the output</b><span>Undo the last action, add another PDF, or insert a blank page.</span></div>

  return <div ref={viewport} className="page-canvas virtual-page-canvas" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} onDragOver={onCanvasDragOver} onClick={(event) => { if (!(event.target as Element).closest('.page-card')) clearSelection() }}>
    <div className="virtual-page-inner" role="listbox" aria-label="Output pages" aria-multiselectable="true" style={{ height: rowCount * rowHeight + padding * 2 }}>
      {visiblePages.map((page, visibleIndex) => {
        const index = startRow * columns + visibleIndex
        const row = Math.floor(index / columns)
        const column = index % columns
        const source = page.sourceId ? sources.get(page.sourceId) : undefined
        const thumbnail = thumbnailFor(page)
        return <PageCard
          key={page.id}
          page={page}
          index={index}
          source={source}
          selected={selectedIds.has(page.id)}
          thumbnail={thumbnail}
          thumbnailVersion={thumbnailVersion}
          requestThumbnail={requestThumbnail}
          dropEdge={dropTarget?.id === page.id ? dropTarget.edge : null}
          style={{ left: leftPadding + column * (zoom + gap), top: padding + row * rowHeight, width: zoom, height: cardHeight, '--source-color': source?.color ?? '#a4a6ab' } as CSSProperties}
          onSelect={(event) => selectPage(page.id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey })}
          onRotate={(degrees) => actOnPage(page.id, () => rotateSelected(degrees))}
          onDelete={() => actOnPage(page.id, deleteSelected)}
          onDuplicate={() => actOnPage(page.id, duplicateSelected)}
          onInsert={() => insertBlank(index + 1)}
          onDragStart={(event) => { if (!selectedIds.has(page.id)) selectPage(page.id); setDraggedId(page.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', page.id) }}
          onDragOver={(event) => { event.preventDefault(); if (!draggedId || draggedId === page.id) return; const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ id: page.id, edge: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after' }) }}
          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (draggedId && dropTarget) reorderByDrag(draggedId, dropTarget.id, dropTarget.edge); setDraggedId(null); setDropTarget(null) }}
          onDragEnd={() => { setDraggedId(null); setDropTarget(null) }}
        />
      })}
    </div>
  </div>
}

type PageCardProps = {
  page: PdfOrganizerPage
  index: number
  source?: StudioSource
  selected: boolean
  thumbnail?: string
  thumbnailVersion: number
  requestThumbnail: (page: PdfOrganizerPage) => void
  dropEdge: PdfDropEdge | null
  style: CSSProperties
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void
  onRotate: (degrees: number) => void
  onDelete: () => void
  onDuplicate: () => void
  onInsert: () => void
  onDragStart: (event: ReactDragEvent<HTMLElement>) => void
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  onDrop: (event: ReactDragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

function PageCard({ page, index, source, selected, thumbnail, thumbnailVersion, requestThumbnail, dropEdge, style, onSelect, onRotate, onDelete, onDuplicate, onInsert, onDragStart, onDragOver, onDrop, onDragEnd }: PageCardProps) {
  useEffect(() => { if (!thumbnail) requestThumbnail(page) }, [page, requestThumbnail, thumbnail, thumbnailVersion])
  return <article
    className={`page-card${selected ? ' selected' : ''}${dropEdge ? ` drop-${dropEdge}` : ''}`}
    style={style}
    draggable
    tabIndex={0}
    role="option"
    aria-label={`Output page ${index + 1}${selected ? ', selected' : ''}`}
    aria-selected={selected}
    onClick={onSelect}
    onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onSelect(event as unknown as ReactMouseEvent<HTMLElement>) } }}
    onDragStart={onDragStart}
    onDragOver={onDragOver}
    onDrop={onDrop}
    onDragEnd={onDragEnd}
  >
    <div className="page-source-stripe"/>
    <div className="page-number">{index + 1}</div>
    <div className="page-select-indicator"><Check/></div>
    <div className="page-actions" onClick={(event) => event.stopPropagation()}>
      <button title="Rotate left" onClick={() => onRotate(-90)}><RotateCcw/></button>
      <button title="Rotate right" onClick={() => onRotate(90)}><RotateCw/></button>
      <button title="Duplicate page" onClick={onDuplicate}><Copy/></button>
      <button title="Delete page" className="danger" onClick={onDelete}><Trash2/></button>
    </div>
    <div className="page-image">
      {page.kind === 'blank' ? <div className="blank-page"><span>Blank</span></div> : thumbnail ? <img style={{ transform: `rotate(${page.rotation}deg)${page.rotation % 180 ? ' scale(.68)' : ''}` }} src={thumbnail} alt=""/> : <div className="page-skeleton"><LoaderCircle className="spin"/></div>}
      {page.kind === 'blank' && page.rotation !== 0 && <span className="rotation-badge">{page.rotation}°</span>}
    </div>
    <footer><span className="source-dot"/><span>{page.kind === 'blank' ? 'Blank page' : `${source?.name ?? 'PDF'} · ${page.sourcePage}`}</span><GripVertical/></footer>
    <button className="insert-page-button" title="Insert blank page here" onClick={(event) => { event.stopPropagation(); onInsert() }}><Plus/></button>
  </article>
}

function PdfToolLoading({ label }: { label: string }) {
  return <div className="pdf-tool-loading"><LoaderCircle className="spin"/><b>{label}…</b></div>
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  const index = bytes ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}
