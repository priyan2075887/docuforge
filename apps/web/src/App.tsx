import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AlignLeft, ArrowLeft, Clock3, Download, FileImage, FilePlus2, FileSpreadsheet, FileText, FolderOpen, Home, Image, LayoutTemplate, LoaderCircle, Menu, MoreHorizontal, PanelLeftClose, Presentation, Save, ScanText, Search, Settings, ShieldCheck, Sparkles, Star, Trash2, Upload, UserRound, X } from 'lucide-react'
import { saveAs } from 'file-saver'
import { createDocument, importFile } from './documentIO'
import { deleteDocument, listDocuments, saveDocument } from './storage'
import type { DocumentKind, Slide, StoredDocument } from './types'
import './App.css'
import './editor.css'

const WriterEditor = lazy(() => import('./components/WriterEditor').then((module) => ({ default: module.WriterEditor })))
const SpreadsheetEditor = lazy(() => import('./components/SpreadsheetEditor').then((module) => ({ default: module.SpreadsheetEditor })))
const SlidesEditor = lazy(() => import('./components/SlidesEditor').then((module) => ({ default: module.SlidesEditor })))
const FileViewer = lazy(() => import('./components/FileViewer').then((module) => ({ default: module.FileViewer })))
const PdfStudio = lazy(() => import('./components/PdfStudio').then((module) => ({ default: module.PdfStudio })))

const kindMeta: Record<DocumentKind, { icon: typeof FileText; className: string; label: string }> = {
  pdf: { icon: FileText, className: 'pdf', label: 'PDF' }, writer: { icon: AlignLeft, className: 'doc', label: 'Writer' }, sheet: { icon: FileSpreadsheet, className: 'sheet', label: 'Sheets' }, slides: { icon: Presentation, className: 'slide', label: 'Slides' }, image: { icon: FileImage, className: 'image', label: 'Image' },
}

function App() {
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [active, setActive] = useState<StoredDocument | null>(null)
  const [sidebar, setSidebar] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [pdfStudio, setPdfStudio] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const restoreRoute = async () => {
      const stored = await listDocuments()
      setDocuments(stored)
      const match = window.location.pathname.match(/^\/(?:document|pdf)\/([^/]+)(?:\/(?:organize|merge|split))?$/)
      if (!match) { setActive(null); setPdfStudio(false); return }
      const routed = stored.find((item) => item.id === decodeURIComponent(match[1]))
      if (!routed) { window.history.replaceState({}, '', '/'); setActive(null); setPdfStudio(false); return }
      setActive(routed)
      setPdfStudio(window.location.pathname.startsWith('/pdf/') && routed.kind === 'pdf')
    }
    const onPopState = () => { void restoreRoute() }
    void restoreRoute()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const refresh = async () => { const stored = await listDocuments(); setDocuments(stored); return stored }
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }
  const openDocument = (document: StoredDocument, replace = false) => {
    setActive(document); setPdfStudio(false)
    window.history[replace ? 'replaceState' : 'pushState']({}, '', `/document/${encodeURIComponent(document.id)}`)
  }
  const openPdfStudio = (document: StoredDocument, mode: 'organize' | 'merge' | 'split' = 'organize', replace = false) => {
    setActive(document); setPdfStudio(true)
    window.history[replace ? 'replaceState' : 'pushState']({}, '', `/pdf/${encodeURIComponent(document.id)}/${mode}`)
  }
  const goHome = () => { setActive(null); setPdfStudio(false); window.history.pushState({}, '', '/') }

  const acceptFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    let imported = 0
    let singleDocument: StoredDocument | null = null
    for (const file of Array.from(files)) {
      try { const document = await importFile(file); await saveDocument(document); imported++; if (files.length === 1) singleDocument = document; const form = new FormData(); form.append('file', file); void fetch('/api/api/v1/documents', { method: 'POST', body: form }).catch(() => undefined) }
      catch (error) { notify(error instanceof Error ? error.message : `Could not import ${file.name}`) }
    }
    await refresh(); setBusy(false)
    if (singleDocument) openDocument(singleDocument)
    if (imported) notify(`${imported} document${imported === 1 ? '' : 's'} imported and saved locally`)
    if (inputRef.current) inputRef.current.value = ''
  }

  const newDocument = async (kind: 'writer' | 'sheet' | 'slides') => { const document = createDocument(kind); await saveDocument(document); await refresh(); openDocument(document) }
  const updateContent = (content: string) => {
    if (!active) return
    const next = { ...active, content, updatedAt: new Date().toISOString() }; setActive(next)
    window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(async () => { await saveDocument(next); await refresh() }, 450)
  }
  const rename = async (name: string) => { if (!active) return; const next = { ...active, name, updatedAt: new Date().toISOString() }; setActive(next); await saveDocument(next); await refresh() }
  const remove = async (document: StoredDocument) => { if (!confirm(`Delete “${document.name}” from this browser?`)) return; await deleteDocument(document.id); if (active?.id === document.id) goHome(); await refresh(); notify('Document deleted') }

  const saveGeneratedPdf = async (blob: Blob, name: string) => {
    const imported = await importFile(new File([blob], name, { type: 'application/pdf' }))
    await saveDocument(imported)
    await refresh()
    notify(`${name} saved to My files`)
  }

  const exportActive = async () => {
    if (!active) return
    if (active.kind === 'writer') {
      const { exportWriterDocx } = await import('./writerExport')
      saveAs(await exportWriterDocx(active.content || ''), active.name.replace(/\.[^.]+$/, '') + '.docx')
    } else if (active.kind === 'sheet') {
      const ExcelJS = (await import('exceljs')).default
      const sheets = JSON.parse(active.content || '[]') as { name: string; rows: unknown[][] }[]; const workbook = new ExcelJS.Workbook(); sheets.forEach((sheet) => { const worksheet = workbook.addWorksheet(sheet.name); sheet.rows.forEach((row) => worksheet.addRow(row)) }); const output = await workbook.xlsx.writeBuffer(); saveAs(new Blob([output as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), active.name.replace(/\.[^.]+$/, '') + '.xlsx')
    } else if (active.kind === 'slides') {
      const PptxGenJS = (await import('pptxgenjs')).default
      const pptx = new PptxGenJS(); (JSON.parse(active.content || '[]') as Slide[]).forEach((item) => { const slide = pptx.addSlide(); slide.background = { color: item.background.replace('#', '') }; slide.addText(item.title, { x: 0.7, y: 1.2, w: 8.6, h: 0.8, fontSize: 28, bold: true, align: 'center' }); slide.addText(item.body, { x: 1, y: 2.3, w: 8, h: 1.5, fontSize: 18, align: 'center' }) }); await pptx.writeFile({ fileName: active.name.replace(/\.[^.]+$/, '') + '.pptx' })
    } else if (active.data) saveAs(new Blob([active.data], { type: active.mimeType }), active.name)
    notify('Export created')
  }

  const filtered = documents.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
  const requestedPdfMode = window.location.pathname.match(/\/(organize|merge|split)$/)?.[1] as 'organize' | 'merge' | 'split' | undefined
  if (active?.kind === 'pdf' && pdfStudio) return <><Suspense fallback={<WorkspaceLoading label="Opening PDF tools"/>}><PdfStudio document={active} back={() => openDocument(active, true)} notify={notify} saveToLibrary={saveGeneratedPdf} initialMode={requestedPdfMode} onModeChange={(mode) => openPdfStudio(active, mode, true)}/></Suspense>{toast && <Toast text={toast} close={() => setToast('')}/>}</>
  if (active) return <div className="editor-app">
    <div className="document-topbar"><button className="back-button" onClick={goHome}><ArrowLeft/></button><div className={`file-icon ${kindMeta[active.kind].className}`}>{(() => { const Icon = kindMeta[active.kind].icon; return <Icon/> })()}</div><input className="document-title" value={active.name} onChange={(e) => void rename(e.target.value)}/><span className="autosave"><ShieldCheck/>Stored locally</span><button className="top-action" onClick={() => void saveDocument(active)}><Save/>Save</button><button className="export-button" onClick={() => void exportActive()}><Download/>Export</button></div>
    <div className="document-workspace"><Suspense fallback={<WorkspaceLoading label="Opening document"/>}>{active.kind === 'writer' && <WriterEditor content={active.content || ''} onChange={updateContent}/>} {active.kind === 'sheet' && <SpreadsheetEditor document={active} onChange={updateContent}/>} {active.kind === 'slides' && <SlidesEditor document={active} onChange={updateContent}/>} {(active.kind === 'pdf' || active.kind === 'image') && <FileViewer document={active} notify={notify} openTools={() => active.kind === 'pdf' && openPdfStudio(active)}/>}</Suspense></div>
    {toast && <Toast text={toast} close={() => setToast('')}/>}</div>

  return <div className="app-shell">
    <aside className={sidebar ? 'sidebar' : 'sidebar collapsed'}><div className="brand-row"><div className="brand-mark"><span>D</span></div>{sidebar && <div><strong>DocuForge</strong><small>Open document studio</small></div>}<button className="icon-button collapse-button" onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelLeftClose/> : <Menu/>}</button></div><button className="new-button" onClick={() => inputRef.current?.click()}><FilePlus2/>{sidebar && <span>Open document</span>}</button><nav className="main-nav"><a className="active"><Home/><span>Home</span></a><a><FolderOpen/><span>My files</span></a><a><Clock3/><span>Recent</span></a><a><Star/><span>Starred</span></a></nav><div className="nav-label">{sidebar && 'TOOLS'}</div><nav className="main-nav tools-nav"><a onClick={() => inputRef.current?.click()}><ScanText/><span>OCR workspace</span><em>AI</em></a><a onClick={() => inputRef.current?.click()}><FileText/><span>PDF tools</span></a><a onClick={() => inputRef.current?.click()}><Image/><span>Image tools</span></a><a><LayoutTemplate/><span>Templates</span></a></nav><div className="sidebar-bottom"><div className="privacy-card"><ShieldCheck/>{sidebar && <div><b>Local-first</b><span>Your files stay on this device</span></div>}</div><nav className="main-nav"><a><Settings/><span>Settings</span></a></nav></div></aside>
    <main><header><div className="search"><Search/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your documents"/><kbd>Ctrl K</kbd></div><div className="header-actions"><button className="avatar"><UserRound/></button></div></header><div className="content"><section className="hero-copy"><div><span className="eyebrow"><Sparkles/> OPEN SOURCE · PRIVATE BY DESIGN</span><h1>Your document workspace</h1><p>Create, import, edit, save and export without sending files to a proprietary cloud.</p></div></section>
      <section className="create-grid"><button className="create-card" onClick={() => void newDocument('writer')}><span className="create-icon doc"><AlignLeft/></span><b>New document</b><small>Rich text and DOCX export</small></button><button className="create-card" onClick={() => void newDocument('sheet')}><span className="create-icon sheet"><FileSpreadsheet/></span><b>New spreadsheet</b><small>Grid, sheets and XLSX export</small></button><button className="create-card" onClick={() => void newDocument('slides')}><span className="create-icon slide"><Presentation/></span><b>New presentation</b><small>Slides and PPTX export</small></button><button className="create-card" onClick={() => inputRef.current?.click()}><span className="create-icon pdf"><FileText/></span><b>Open files</b><small>PDF, Office documents & images</small></button></section>
      <section className="upload-panel" onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void acceptFiles(e.dataTransfer.files) }}><div className={dragging ? 'drop-zone dragging' : 'drop-zone'}><div className="upload-graphic"><Upload/><span><FileImage/></span></div><div><h3>{busy ? 'Importing documents…' : 'Drop documents here'}</h3><p>PDF, DOCX, XLSX, CSV, PPTX, text and images · Up to 100 MB</p></div><button onClick={() => inputRef.current?.click()} disabled={busy}>Browse files</button><input ref={inputRef} hidden multiple type="file" accept=".pdf,.doc,.docx,.odt,.txt,.md,.html,.xls,.xlsx,.csv,.ods,.ppt,.pptx,.odp,image/*" onChange={(e) => void acceptFiles(e.target.files)}/></div></section>
      <section className="recent-section"><div className="section-heading"><div><h2>Your files</h2><p>{documents.length ? `${documents.length} document${documents.length === 1 ? '' : 's'} saved in this browser` : 'Import a file or create your first document'}</p></div></div><div className="file-table"><div className="table-head"><span>Name</span><span>Type</span><span>Modified</span><span></span></div>{filtered.map((file) => { const meta = kindMeta[file.kind]; const Icon = meta.icon; return <div className="file-row" key={file.id} onClick={() => openDocument(file)}><div className="file-name"><span className={`file-icon ${meta.className}`}><Icon/></span><div><b>{file.name}</b><small>{formatBytes(file.size)}</small></div></div><span className={`type-pill ${meta.className}`}>{meta.label}</span><span className="updated">{new Date(file.updatedAt).toLocaleString()}</span><span className="row-actions"><button title="Delete" onClick={(e) => { e.stopPropagation(); void remove(file) }}><Trash2/></button><MoreHorizontal/></span></div> })}{!filtered.length && <div className="empty-search">{query ? `No files match “${query}”` : 'No documents yet. Create or import one above.'}</div>}</div></section><footer>DocuForge is open source · Documents are persisted locally in IndexedDB</footer></div></main>{toast && <Toast text={toast} close={() => setToast('')}/>}</div>
}

function Toast({ text, close }: { text: string; close: () => void }) { return <div className="toast"><ShieldCheck/>{text}<button onClick={close}><X/></button></div> }
function WorkspaceLoading({ label }: { label: string }) { return <div className="workspace-loading"><LoaderCircle className="spin"/><b>{label}…</b></div> }
function formatBytes(bytes: number) { if (!bytes) return 'Locally created'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}` }
export default App
