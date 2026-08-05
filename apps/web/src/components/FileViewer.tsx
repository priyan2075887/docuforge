import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Copy, Download, LoaderCircle, RefreshCw, ScanText, Wrench } from 'lucide-react'
import { saveAs } from 'file-saver'
import type { StoredDocument } from '../types'
import './FileViewer.css'

type Status = { state: 'idle' | 'loading' | 'success' | 'error'; message: string }

export function FileViewer({ document, notify, openTools }: { document: StoredDocument; notify: (text: string) => void; openTools?: () => void }) {
  const [url, setUrl] = useState('')
  const [analysis, setAnalysis] = useState<Status>({ state: 'idle', message: '' })
  const [ocr, setOcr] = useState<Status>({ state: 'idle', message: '' })
  const [ocrText, setOcrText] = useState('')
  useEffect(() => { if (!document.data) return; const objectUrl = URL.createObjectURL(new Blob([document.data], { type: document.mimeType || 'application/pdf' })); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl) }, [document])

  const inspect = async () => {
    if (!document.data) return
    setAnalysis({ state: 'loading', message: 'Checking the PDF text layer…' })
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 30_000)
    try {
      const health = await fetch('/api/health', { signal: controller.signal }); if (!health.ok) throw new Error('The local document backend is not ready.')
      const form = new FormData(); form.append('file', new File([document.data], document.name, { type: 'application/pdf' }))
      const response = await fetch('/api/api/v1/documents/inspect', { method: 'POST', body: form, signal: controller.signal }); const contentType = response.headers.get('content-type') || ''; const result = contentType.includes('application/json') ? await response.json() : null
      if (!response.ok) throw new Error(result?.detail || `PDF analysis failed (HTTP ${response.status}).`)
      setAnalysis({ state: 'success', message: `${result.page_count} pages · ${result.ocr_pages} require OCR` }); notify('PDF analysis completed')
    } catch (error) { const offline = error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError'); setAnalysis({ state: 'error', message: offline ? 'Backend offline. Start FastAPI on port 8000.' : error instanceof Error ? error.message : 'PDF analysis failed.' }) }
    finally { window.clearTimeout(timeout) }
  }

  const recognize = async () => {
    if (!document.data) return
    setOcr({ state: 'loading', message: 'Running local PP-OCRv5…' }); setOcrText('')
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 10 * 60_000)
    try {
      const form = new FormData(); form.append('file', new File([document.data], document.name, { type: 'application/pdf' }))
      const response = await fetch('/api/api/v1/ocr/recognize?dpi=200', { method: 'POST', body: form, signal: controller.signal }); const result = await response.json()
      if (!response.ok) { const detail = typeof result.detail === 'object' ? result.detail.message : result.detail; throw new Error(detail || `OCR failed (HTTP ${response.status}).`) }
      setOcrText(result.text || ''); const count = result.pages.filter((page: { source: string }) => page.source === 'paddleocr').length
      setOcr({ state: 'success', message: `PP-OCRv5 completed · ${count} scanned page(s) recognized` }); notify('PaddleOCR completed')
    } catch (error) { const timedOut = error instanceof DOMException && error.name === 'AbortError'; setOcr({ state: 'error', message: timedOut ? 'OCR timed out after 10 minutes.' : error instanceof TypeError ? 'The local backend is offline.' : error instanceof Error ? error.message : 'OCR failed.' }) }
    finally { window.clearTimeout(timeout) }
  }

  const status = (value: Status, retry?: () => void) => value.message && <div className={`analysis-status ${value.state}`}>{value.state === 'success' ? <CheckCircle2/> : value.state === 'error' ? <AlertCircle/> : <LoaderCircle className="spin"/>}<span>{value.message}</span>{value.state === 'error' && retry && <button onClick={retry}><RefreshCw/>Retry</button>}</div>
  return <div className="viewer-shell"><div className="viewer-toolbar"><button onClick={() => document.data && saveAs(new Blob([document.data], { type: document.mimeType }), document.name)}><Download/>Original</button>{document.kind === 'pdf' && <><button onClick={openTools}><Wrench/>PDF tools</button><button disabled={analysis.state === 'loading'} onClick={() => void inspect()}><ScanText/>Analyze PDF</button><button className="ocr-button" disabled={ocr.state === 'loading'} onClick={() => void recognize()}>{ocr.state === 'loading' ? <LoaderCircle className="spin"/> : <ScanText/>}Run PaddleOCR</button></>}{status(analysis, () => void inspect())}</div>{ocr.message && <div className="ocr-progress">{status(ocr, () => void recognize())}</div>}{ocrText && <div className="ocr-result"><div><b>Recognized text</b><button onClick={() => void navigator.clipboard.writeText(ocrText)}><Copy/>Copy</button><button onClick={() => saveAs(new Blob([ocrText], { type: 'text/plain;charset=utf-8' }), document.name.replace(/\.pdf$/i, '') + '.txt')}><Download/>Export TXT</button></div><textarea readOnly value={ocrText}/></div>}<div className="viewer-stage">{document.kind === 'image' ? <img src={url} alt={document.name}/> : <iframe src={url} title={document.name}/>}</div></div>
}
