import { useCallback, useMemo, useReducer } from 'react'

export type PdfPageRotation = 0 | 90 | 180 | 270
export type PdfDropEdge = 'before' | 'after'
export type PdfMoveDirection = 'backward' | 'forward'

/** Metadata for one PDF added to an organizer session. Keep the file/blob outside history. */
export interface PdfOrganizerSource {
  id: string
  name: string
  color: string
  pageCount: number
}

/** A visual page in the composed output. Duplicates deliberately share source coordinates. */
export interface PdfOrganizerPage {
  id: string
  kind: 'pdf' | 'blank'
  sourceId: string | null
  /** One-based page number in the source PDF; null for a generated blank page. */
  sourcePage: number | null
  rotation: PdfPageRotation
  width?: number
  height?: number
  thumbnail?: string
  duplicateOf?: string
}

export interface PdfSelectionGesture {
  /** Ctrl/Cmd-click semantics. When combined with range, add the range. */
  toggle?: boolean
  /** Shift-click semantics, using the existing selection anchor. */
  range?: boolean
}

export interface PdfSelectionResult {
  selectedIds: string[]
  selectionAnchorId: string | null
}

export interface AlternateMixOptions {
  startWith?: 'first' | 'second'
  reverseFirst?: boolean
  reverseSecond?: boolean
}

export interface DuplicatePagesResult {
  pages: PdfOrganizerPage[]
  duplicatedIds: string[]
}

interface PdfOrganizerFrame {
  pages: PdfOrganizerPage[]
  selectedIds: string[]
  selectionAnchorId: string | null
}

export interface PdfOrganizerState extends PdfOrganizerFrame {
  past: PdfOrganizerFrame[]
  future: PdfOrganizerFrame[]
}

export interface PdfOrganizerStateOptions {
  historyLimit?: number
  createId?: () => string
  blankPageSize?: {
    width: number
    height: number
  }
}

export interface PdfBlankPageOverrides {
  width?: number
  height?: number
  thumbnail?: string
}

export type PdfOrganizerAction =
  | { type: 'reset'; pages: readonly PdfOrganizerPage[] }
  | { type: 'replace-pages'; pages: readonly PdfOrganizerPage[]; historyLimit: number }
  | { type: 'append-pages'; pages: readonly PdfOrganizerPage[]; selectAdded: boolean; historyLimit: number }
  | { type: 'select-page'; id: string; gesture: PdfSelectionGesture }
  | { type: 'clear-selection' }
  | { type: 'select-all' }
  | { type: 'select-odd' }
  | { type: 'select-even' }
  | { type: 'delete-selected'; historyLimit: number }
  | { type: 'rotate-selected'; degrees: number; historyLimit: number }
  | { type: 'duplicate-selected'; createId: () => string; historyLimit: number }
  | { type: 'insert-blank'; index: number; page: PdfOrganizerPage; historyLimit: number }
  | { type: 'move-selected'; direction: PdfMoveDirection; historyLimit: number }
  | { type: 'reorder-drag'; draggedId: string; targetId: string; edge: PdfDropEdge; historyLimit: number }
  | { type: 'reverse-selected'; historyLimit: number }
  | { type: 'alternate-mix'; firstSourceId: string; secondSourceId: string; options: AlternateMixOptions; historyLimit: number }
  | { type: 'undo'; historyLimit: number }
  | { type: 'redo'; historyLimit: number }

const DEFAULT_HISTORY_LIMIT = 80
const DEFAULT_BLANK_SIZE = { width: 595, height: 842 }

function defaultCreateId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `pdf-page-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function asIdSet(ids: ReadonlySet<string> | readonly string[]) {
  return ids instanceof Set ? ids : new Set(ids)
}

function uniqueExistingIds(pages: readonly PdfOrganizerPage[], ids: readonly string[]) {
  const existing = new Set(pages.map((page) => page.id))
  return [...new Set(ids)].filter((id) => existing.has(id))
}

function normalizedRotation(degrees: number): PdfPageRotation {
  const normalized = ((degrees % 360) + 360) % 360
  const snapped = Math.round(normalized / 90) * 90 % 360
  return snapped as PdfPageRotation
}

function pageSequenceIsIdentical(left: readonly PdfOrganizerPage[], right: readonly PdfOrganizerPage[]) {
  return left.length === right.length && left.every((page, index) => page === right[index])
}

function frameFromState(state: PdfOrganizerState): PdfOrganizerFrame {
  return {
    pages: state.pages,
    selectedIds: state.selectedIds,
    selectionAnchorId: state.selectionAnchorId,
  }
}

function commitPages(
  state: PdfOrganizerState,
  pages: readonly PdfOrganizerPage[],
  selectedIds: readonly string[],
  selectionAnchorId: string | null,
  historyLimit: number,
) {
  const nextPages = [...pages]
  const nextSelection = uniqueExistingIds(nextPages, selectedIds)
  const nextAnchor = selectionAnchorId && nextPages.some((page) => page.id === selectionAnchorId)
    ? selectionAnchorId
    : null
  if (
    pageSequenceIsIdentical(state.pages, nextPages)
    && state.selectedIds.length === nextSelection.length
    && state.selectedIds.every((id, index) => id === nextSelection[index])
    && state.selectionAnchorId === nextAnchor
  ) return state

  return {
    pages: nextPages,
    selectedIds: nextSelection,
    selectionAnchorId: nextAnchor,
    past: [...state.past, frameFromState(state)].slice(-historyLimit),
    future: [],
  }
}

export function createPdfOrganizerState(initialPages: readonly PdfOrganizerPage[] = []): PdfOrganizerState {
  return {
    pages: [...initialPages],
    selectedIds: [],
    selectionAnchorId: null,
    past: [],
    future: [],
  }
}

export function selectPageIds(
  pages: readonly PdfOrganizerPage[],
  currentIds: readonly string[],
  selectionAnchorId: string | null,
  id: string,
  gesture: PdfSelectionGesture = {},
): PdfSelectionResult {
  const pageIds = pages.map((page) => page.id)
  const clickedIndex = pageIds.indexOf(id)
  if (clickedIndex < 0) return { selectedIds: [...currentIds], selectionAnchorId }

  const current = new Set(uniqueExistingIds(pages, currentIds))
  if (gesture.range) {
    const anchorIndex = selectionAnchorId ? pageIds.indexOf(selectionAnchorId) : -1
    const effectiveAnchor = anchorIndex >= 0 ? anchorIndex : clickedIndex
    const from = Math.min(effectiveAnchor, clickedIndex)
    const to = Math.max(effectiveAnchor, clickedIndex)
    const rangeIds = pageIds.slice(from, to + 1)
    const selected = gesture.toggle ? new Set([...current, ...rangeIds]) : new Set(rangeIds)
    return {
      selectedIds: pageIds.filter((pageId) => selected.has(pageId)),
      selectionAnchorId: anchorIndex >= 0 ? selectionAnchorId : id,
    }
  }

  if (gesture.toggle) {
    if (current.has(id)) current.delete(id)
    else current.add(id)
    return {
      selectedIds: pageIds.filter((pageId) => current.has(pageId)),
      selectionAnchorId: id,
    }
  }

  return { selectedIds: [id], selectionAnchorId: id }
}

export function selectAllPageIds(pages: readonly PdfOrganizerPage[]) {
  return pages.map((page) => page.id)
}

export function selectOddPageIds(pages: readonly PdfOrganizerPage[]) {
  return pages.filter((_, index) => index % 2 === 0).map((page) => page.id)
}

export function selectEvenPageIds(pages: readonly PdfOrganizerPage[]) {
  return pages.filter((_, index) => index % 2 === 1).map((page) => page.id)
}

export function deleteSelectedPages(
  pages: readonly PdfOrganizerPage[],
  selectedIds: ReadonlySet<string> | readonly string[],
) {
  const selected = asIdSet(selectedIds)
  return pages.filter((page) => !selected.has(page.id))
}

export function rotateSelectedPages(
  pages: readonly PdfOrganizerPage[],
  selectedIds: ReadonlySet<string> | readonly string[],
  degrees: number,
) {
  const selected = asIdSet(selectedIds)
  if (!selected.size || normalizedRotation(degrees) === 0) return [...pages]
  return pages.map((page) => selected.has(page.id)
    ? { ...page, rotation: normalizedRotation(page.rotation + degrees) }
    : page)
}

export function duplicateSelectedPages(
  pages: readonly PdfOrganizerPage[],
  selectedIds: ReadonlySet<string> | readonly string[],
  createId: () => string = defaultCreateId,
): DuplicatePagesResult {
  const selected = asIdSet(selectedIds)
  const duplicatedIds: string[] = []
  const result: PdfOrganizerPage[] = []
  for (const page of pages) {
    result.push(page)
    if (!selected.has(page.id)) continue
    const id = createId()
    duplicatedIds.push(id)
    result.push({ ...page, id, duplicateOf: page.duplicateOf ?? page.id })
  }
  return { pages: result, duplicatedIds }
}

export function insertBlankPage(
  pages: readonly PdfOrganizerPage[],
  index: number,
  blankPage: PdfOrganizerPage,
) {
  const insertionIndex = Math.max(0, Math.min(Math.trunc(index), pages.length))
  return [...pages.slice(0, insertionIndex), blankPage, ...pages.slice(insertionIndex)]
}

export function moveSelectedPages(
  pages: readonly PdfOrganizerPage[],
  selectedIds: ReadonlySet<string> | readonly string[],
  direction: PdfMoveDirection,
) {
  const selected = asIdSet(selectedIds)
  if (!selected.size || pages.length < 2) return [...pages]
  const result = [...pages]
  if (direction === 'backward') {
    for (let index = 1; index < result.length; index += 1) {
      if (selected.has(result[index].id) && !selected.has(result[index - 1].id)) {
        const previous = result[index - 1]
        result[index - 1] = result[index]
        result[index] = previous
      }
    }
  } else {
    for (let index = result.length - 2; index >= 0; index -= 1) {
      if (selected.has(result[index].id) && !selected.has(result[index + 1].id)) {
        const next = result[index + 1]
        result[index + 1] = result[index]
        result[index] = next
      }
    }
  }
  return result
}

export function reorderPagesByDrag(
  pages: readonly PdfOrganizerPage[],
  selectedIds: ReadonlySet<string> | readonly string[],
  draggedId: string,
  targetId: string,
  edge: PdfDropEdge = 'before',
) {
  if (draggedId === targetId) return [...pages]
  const selected = asIdSet(selectedIds)
  const movingIds = selected.has(draggedId) ? selected : new Set([draggedId])
  if (movingIds.has(targetId) || !pages.some((page) => page.id === draggedId)) return [...pages]

  const moving = pages.filter((page) => movingIds.has(page.id))
  const remaining = pages.filter((page) => !movingIds.has(page.id))
  const targetIndex = remaining.findIndex((page) => page.id === targetId)
  if (targetIndex < 0) return [...pages]
  const insertionIndex = targetIndex + (edge === 'after' ? 1 : 0)
  return [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ]
}

/** Reverse page values only within selected slots, leaving unselected slots untouched. */
export function reverseSelectedPages(
  pages: readonly PdfOrganizerPage[],
  selectedIds: ReadonlySet<string> | readonly string[],
) {
  const selected = asIdSet(selectedIds)
  const selectedIndexes = pages
    .map((page, index) => selected.has(page.id) ? index : -1)
    .filter((index) => index >= 0)
  if (selectedIndexes.length < 2) return [...pages]
  const reversed = selectedIndexes.map((index) => pages[index]).reverse()
  const result = [...pages]
  selectedIndexes.forEach((index, position) => { result[index] = reversed[position] })
  return result
}

/**
 * Interleave all pages from two sources at their first participating position.
 * Pages from unrelated sources retain their relative order and stay before/after that block.
 */
export function alternateMixPages(
  pages: readonly PdfOrganizerPage[],
  firstSourceId: string,
  secondSourceId: string,
  options: AlternateMixOptions = {},
) {
  if (firstSourceId === secondSourceId) return [...pages]
  let first = pages.filter((page) => page.sourceId === firstSourceId)
  let second = pages.filter((page) => page.sourceId === secondSourceId)
  if (!first.length || !second.length) return [...pages]
  if (options.reverseFirst) first = [...first].reverse()
  if (options.reverseSecond) second = [...second].reverse()

  const primary = options.startWith === 'second' ? second : first
  const secondary = options.startWith === 'second' ? first : second
  const mixed: PdfOrganizerPage[] = []
  for (let index = 0; index < Math.max(primary.length, secondary.length); index += 1) {
    if (primary[index]) mixed.push(primary[index])
    if (secondary[index]) mixed.push(secondary[index])
  }

  const participates = (page: PdfOrganizerPage) => page.sourceId === firstSourceId || page.sourceId === secondSourceId
  const firstParticipantIndex = pages.findIndex(participates)
  const prefix = pages.slice(0, firstParticipantIndex).filter((page) => !participates(page))
  const suffix = pages.slice(firstParticipantIndex).filter((page) => !participates(page))
  return [...prefix, ...mixed, ...suffix]
}

export function pdfOrganizerReducer(state: PdfOrganizerState, action: PdfOrganizerAction): PdfOrganizerState {
  const selected = new Set(state.selectedIds)
  switch (action.type) {
    case 'reset':
      return createPdfOrganizerState(action.pages)
    case 'replace-pages':
      return commitPages(state, action.pages, state.selectedIds, state.selectionAnchorId, action.historyLimit)
    case 'append-pages': {
      const nextPages = [...state.pages, ...action.pages]
      const nextSelection = action.selectAdded
        ? action.pages.map((page) => page.id)
        : state.selectedIds
      const nextAnchor = action.selectAdded ? action.pages[0]?.id ?? null : state.selectionAnchorId
      return commitPages(state, nextPages, nextSelection, nextAnchor, action.historyLimit)
    }
    case 'select-page': {
      const selection = selectPageIds(
        state.pages,
        state.selectedIds,
        state.selectionAnchorId,
        action.id,
        action.gesture,
      )
      return { ...state, ...selection }
    }
    case 'clear-selection':
      return { ...state, selectedIds: [], selectionAnchorId: null }
    case 'select-all':
      return { ...state, selectedIds: selectAllPageIds(state.pages), selectionAnchorId: state.pages[0]?.id ?? null }
    case 'select-odd': {
      const ids = selectOddPageIds(state.pages)
      return { ...state, selectedIds: ids, selectionAnchorId: ids[0] ?? null }
    }
    case 'select-even': {
      const ids = selectEvenPageIds(state.pages)
      return { ...state, selectedIds: ids, selectionAnchorId: ids[0] ?? null }
    }
    case 'delete-selected':
      return commitPages(
        state,
        deleteSelectedPages(state.pages, selected),
        [],
        null,
        action.historyLimit,
      )
    case 'rotate-selected':
      return commitPages(
        state,
        rotateSelectedPages(state.pages, selected, action.degrees),
        state.selectedIds,
        state.selectionAnchorId,
        action.historyLimit,
      )
    case 'duplicate-selected': {
      const result = duplicateSelectedPages(state.pages, selected, action.createId)
      return commitPages(
        state,
        result.pages,
        result.duplicatedIds,
        result.duplicatedIds[0] ?? null,
        action.historyLimit,
      )
    }
    case 'insert-blank':
      return commitPages(
        state,
        insertBlankPage(state.pages, action.index, action.page),
        [action.page.id],
        action.page.id,
        action.historyLimit,
      )
    case 'move-selected':
      return commitPages(
        state,
        moveSelectedPages(state.pages, selected, action.direction),
        state.selectedIds,
        state.selectionAnchorId,
        action.historyLimit,
      )
    case 'reorder-drag':
      return commitPages(
        state,
        reorderPagesByDrag(state.pages, selected, action.draggedId, action.targetId, action.edge),
        selected.has(action.draggedId) ? state.selectedIds : [action.draggedId],
        action.draggedId,
        action.historyLimit,
      )
    case 'reverse-selected':
      return commitPages(
        state,
        reverseSelectedPages(state.pages, selected),
        state.selectedIds,
        state.selectionAnchorId,
        action.historyLimit,
      )
    case 'alternate-mix':
      return commitPages(
        state,
        alternateMixPages(state.pages, action.firstSourceId, action.secondSourceId, action.options),
        state.selectedIds,
        state.selectionAnchorId,
        action.historyLimit,
      )
    case 'undo': {
      const previous = state.past.at(-1)
      if (!previous) return state
      return {
        ...previous,
        past: state.past.slice(0, -1),
        future: [frameFromState(state), ...state.future].slice(0, action.historyLimit),
      }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return {
        ...next,
        past: [...state.past, frameFromState(state)].slice(-action.historyLimit),
        future: state.future.slice(1),
      }
    }
  }
}

export function usePdfOrganizerState(
  initialPages: readonly PdfOrganizerPage[] = [],
  options: PdfOrganizerStateOptions = {},
) {
  const [state, dispatch] = useReducer(pdfOrganizerReducer, initialPages, createPdfOrganizerState)
  const historyLimit = Math.max(1, Math.trunc(options.historyLimit ?? DEFAULT_HISTORY_LIMIT))
  const createId = options.createId ?? defaultCreateId
  const blankPageSize = options.blankPageSize ?? DEFAULT_BLANK_SIZE
  const selectedIds = useMemo(() => new Set(state.selectedIds), [state.selectedIds])

  const reset = useCallback((pages: readonly PdfOrganizerPage[] = initialPages) => {
    dispatch({ type: 'reset', pages })
  }, [initialPages])
  const replacePages = useCallback((pages: readonly PdfOrganizerPage[]) => {
    dispatch({ type: 'replace-pages', pages, historyLimit })
  }, [historyLimit])
  const appendPages = useCallback((pages: readonly PdfOrganizerPage[], selectAdded = false) => {
    dispatch({ type: 'append-pages', pages, selectAdded, historyLimit })
  }, [historyLimit])
  const selectPage = useCallback((id: string, gesture: PdfSelectionGesture = {}) => {
    dispatch({ type: 'select-page', id, gesture })
  }, [])
  const clearSelection = useCallback(() => dispatch({ type: 'clear-selection' }), [])
  const selectAll = useCallback(() => dispatch({ type: 'select-all' }), [])
  const selectOdd = useCallback(() => dispatch({ type: 'select-odd' }), [])
  const selectEven = useCallback(() => dispatch({ type: 'select-even' }), [])
  const deleteSelected = useCallback(() => dispatch({ type: 'delete-selected', historyLimit }), [historyLimit])
  const rotateSelected = useCallback((degrees: number) => {
    dispatch({ type: 'rotate-selected', degrees, historyLimit })
  }, [historyLimit])
  const duplicateSelected = useCallback(() => {
    dispatch({ type: 'duplicate-selected', createId, historyLimit })
  }, [createId, historyLimit])
  const insertBlank = useCallback((index: number, overrides: PdfBlankPageOverrides = {}) => {
    const page: PdfOrganizerPage = {
      id: createId(),
      kind: 'blank',
      sourceId: null,
      sourcePage: null,
      rotation: 0,
      width: overrides.width ?? blankPageSize.width,
      height: overrides.height ?? blankPageSize.height,
      thumbnail: overrides.thumbnail,
    }
    dispatch({ type: 'insert-blank', index, page, historyLimit })
  }, [blankPageSize.height, blankPageSize.width, createId, historyLimit])
  const moveSelected = useCallback((direction: PdfMoveDirection) => {
    dispatch({ type: 'move-selected', direction, historyLimit })
  }, [historyLimit])
  const reorderByDrag = useCallback((draggedId: string, targetId: string, edge: PdfDropEdge = 'before') => {
    dispatch({ type: 'reorder-drag', draggedId, targetId, edge, historyLimit })
  }, [historyLimit])
  const reverseSelected = useCallback(() => dispatch({ type: 'reverse-selected', historyLimit }), [historyLimit])
  const alternateMix = useCallback((
    firstSourceId: string,
    secondSourceId: string,
    mixOptions: AlternateMixOptions = {},
  ) => {
    dispatch({
      type: 'alternate-mix',
      firstSourceId,
      secondSourceId,
      options: mixOptions,
      historyLimit,
    })
  }, [historyLimit])
  const undo = useCallback(() => dispatch({ type: 'undo', historyLimit }), [historyLimit])
  const redo = useCallback(() => dispatch({ type: 'redo', historyLimit }), [historyLimit])

  return {
    pages: state.pages,
    selectedIds,
    selectionAnchorId: state.selectionAnchorId,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    reset,
    replacePages,
    appendPages,
    selectPage,
    clearSelection,
    selectAll,
    selectOdd,
    selectEven,
    deleteSelected,
    rotateSelected,
    duplicateSelected,
    insertBlank,
    moveSelected,
    reorderByDrag,
    reverseSelected,
    alternateMix,
    undo,
    redo,
  }
}
