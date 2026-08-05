import { useMemo, useState } from 'react'
import type { StoredDocument } from '../types'

type Sheet = { name: string; rows: (string | number)[][] }
const letters = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))

export function SpreadsheetEditor({ document, onChange }: { document: StoredDocument; onChange: (content: string) => void }) {
  const initial = useMemo<Sheet[]>(() => { try { return JSON.parse(document.content || '[]') } catch { return [] } }, [document.content])
  const [sheets, setSheets] = useState(initial.length ? initial : [{ name: 'Sheet1', rows: [] }])
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState({ row: 0, col: 0 })
  const sheet = sheets[active]
  const value = sheet.rows[selected.row]?.[selected.col] ?? ''
  const update = (row: number, col: number, next: string) => {
    const copy = structuredClone(sheets); copy[active].rows[row] ||= []; copy[active].rows[row][col] = next
    setSheets(copy); onChange(JSON.stringify(copy))
  }
  const addSheet = () => { const copy = [...sheets, { name: `Sheet${sheets.length + 1}`, rows: [] }]; setSheets(copy); setActive(copy.length - 1); onChange(JSON.stringify(copy)) }
  return <div className="sheet-shell">
    <div className="formula-bar"><span className="cell-ref">{letters[selected.col]}{selected.row + 1}</span><span className="fx">fx</span><input value={value} onChange={(e) => update(selected.row, selected.col, e.target.value)}/></div>
    <div className="grid-wrap"><table className="spreadsheet"><thead><tr><th></th>{letters.map((letter) => <th key={letter}>{letter}</th>)}</tr></thead><tbody>{Array.from({ length: 60 }, (_, row) => <tr key={row}><th>{row + 1}</th>{letters.map((_, col) => <td key={col} className={selected.row === row && selected.col === col ? 'selected' : ''} onClick={() => setSelected({ row, col })}><input value={sheet.rows[row]?.[col] ?? ''} onFocus={() => setSelected({ row, col })} onChange={(e) => update(row, col, e.target.value)}/></td>)}</tr>)}</tbody></table></div>
    <div className="sheet-tabs"><button onClick={addSheet}>+</button>{sheets.map((item, index) => <button className={active === index ? 'active' : ''} onClick={() => setActive(index)} key={item.name}>{item.name}</button>)}</div>
  </div>
}
