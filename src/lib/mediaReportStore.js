const DB_NAME = 'asvn-media-report-db'
const STORE_NAME = 'reports'
const DB_VERSION = 1

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION)

  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
  }

  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('Khong mo duoc IndexedDB'))
})

const runStore = async (mode, handler) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const request = handler(store)

    tx.oncomplete = () => resolve(request?.result)
    tx.onerror = () => reject(tx.error || request?.error || new Error('Loi IndexedDB'))
    tx.onabort = () => reject(tx.error || request?.error || new Error('IndexedDB bi huy'))
  }).finally(() => db.close())
}

export const saveMediaReport = async (report) => {
  await runStore('readwrite', (store) => store.put(report))
  return report.id
}

export const loadMediaReport = async (id) => {
  const result = await runStore('readonly', (store) => store.get(id))
  return result || null
}

export const deleteMediaReport = async (id) => {
  await runStore('readwrite', (store) => store.delete(id))
}
