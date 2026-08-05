import { openDB } from 'idb'
import type { StoredDocument } from './types'

const db = openDB('docuforge', 1, {
  upgrade(database) {
    const documents = database.createObjectStore('documents', { keyPath: 'id' })
    documents.createIndex('updatedAt', 'updatedAt')
  },
})

export async function listDocuments(): Promise<StoredDocument[]> {
  const values = await (await db).getAll('documents') as StoredDocument[]
  return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getDocument(id: string): Promise<StoredDocument | undefined> {
  return (await db).get('documents', id) as Promise<StoredDocument | undefined>
}

export async function saveDocument(document: StoredDocument): Promise<void> {
  await (await db).put('documents', document)
}

export async function deleteDocument(id: string): Promise<void> {
  await (await db).delete('documents', id)
}
