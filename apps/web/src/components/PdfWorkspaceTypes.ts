export type PdfWorkspaceResult = {
  blob: Blob
  filename: string
  mimeType: 'application/pdf' | 'application/zip'
}

export type PdfResultHandler = (result: PdfWorkspaceResult) => void | Promise<void>
