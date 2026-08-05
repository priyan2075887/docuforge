export type DocumentKind = 'writer' | 'sheet' | 'slides' | 'pdf' | 'image'

export type StoredDocument = {
  id: string
  name: string
  kind: DocumentKind
  mimeType: string
  size: number
  createdAt: string
  updatedAt: string
  data?: ArrayBuffer
  content?: string
  starred?: boolean
}

export type Slide = { id: string; title: string; body: string; background: string }
