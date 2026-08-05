import { useMemo, useState } from 'react'
import { Plus, Trash2, Play } from 'lucide-react'
import type { Slide, StoredDocument } from '../types'

export function SlidesEditor({ document, onChange }: { document: StoredDocument; onChange: (content: string) => void }) {
  const initial = useMemo<Slide[]>(() => { try { return JSON.parse(document.content || '[]') } catch { return [] } }, [document.content])
  const [slides, setSlides] = useState(initial)
  const [active, setActive] = useState(0)
  const [presenting, setPresenting] = useState(false)
  const commit = (next: Slide[]) => { setSlides(next); onChange(JSON.stringify(next)) }
  const patch = (values: Partial<Slide>) => commit(slides.map((slide, index) => index === active ? { ...slide, ...values } : slide))
  const add = () => { const next = [...slides, { id: crypto.randomUUID(), title: 'New slide', body: 'Click to edit', background: '#ffffff' }]; commit(next); setActive(next.length - 1) }
  const remove = () => { if (slides.length === 1) return; const next = slides.filter((_, index) => index !== active); commit(next); setActive(Math.max(0, active - 1)) }
  const slide = slides[active]
  return <div className="slides-shell">
    <div className="slide-tools"><button onClick={add}><Plus/>New slide</button><button onClick={remove}><Trash2/>Delete</button><label>Background <input type="color" value={slide.background} onChange={(e) => patch({ background: e.target.value })}/></label><button className="present-button" onClick={() => setPresenting(true)}><Play/>Present</button></div>
    <div className="slides-body"><aside className="slide-list">{slides.map((item, index) => <button className={active === index ? 'active' : ''} key={item.id} onClick={() => setActive(index)}><span>{index + 1}</span><div style={{ background: item.background }}><b>{item.title}</b></div></button>)}</aside><div className="slide-stage"><div className="slide-canvas" style={{ background: slide.background }}><input className="slide-title" value={slide.title} onChange={(e) => patch({ title: e.target.value })}/><textarea value={slide.body} onChange={(e) => patch({ body: e.target.value })}/></div></div></div>
    {presenting && <div className="presentation-mode" onClick={() => setPresenting(false)}><div style={{ background: slide.background }}><h1>{slide.title}</h1><p>{slide.body}</p><small>Click anywhere to exit</small></div></div>}
  </div>
}
