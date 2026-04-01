import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { put as putBlob } from '@vercel/blob'
import mssql from 'mssql'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const mediaRoot = path.join(projectRoot, 'local-media', 'media')
const outputDir = path.join(projectRoot, 'migration-output')

const sqlServerHost = process.env.SQLSERVER_HOST || process.env.COMPUTERNAME || 'DESKTOP-K6GPG8E'
const sqlServerDatabase = process.env.SQLSERVER_DATABASE || 'ASVN_Local'
const connectionString = process.env.SQLSERVER_CONNECTION_STRING || (
  process.env.SQLSERVER_USER && process.env.SQLSERVER_PASSWORD
    ? `Server=${sqlServerHost};Database=${sqlServerDatabase};User ID=${process.env.SQLSERVER_USER};Password=${process.env.SQLSERVER_PASSWORD};TrustServerCertificate=True;Encrypt=False;`
    : `Server=${sqlServerHost};Database=${sqlServerDatabase};Integrated Security=True;TrustServerCertificate=True;Encrypt=False;`
)

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error('Can BLOB_READ_WRITE_TOKEN de migrate media len Vercel Blob.')
}

function isAbsoluteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function normalizeMedia(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function inferContentType(item, fallbackPath = '') {
  if (item?.type === 'video') return 'video/mp4'
  const ext = path.extname(fallbackPath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mov') return 'video/quicktime'
  return 'image/jpeg'
}

function dataUriToBuffer(dataUri) {
  const match = String(dataUri || '').match(/^data:([^;,]+)?(?:;base64)?,(.*)$/)
  if (!match) throw new Error('Data URI khong hop le.')
  const mime = match[1] || 'application/octet-stream'
  const body = match[2] || ''
  return { mime, buffer: Buffer.from(body, 'base64') }
}

async function uploadBufferToBlob(blobPath, buffer, contentType) {
  const blob = await putBlob(blobPath, buffer, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
  })
  return blob.url
}

async function migrateMediaItem(customerId, item, index) {
  if (!item) return { nextItem: item, status: 'skipped', reason: 'empty-item' }
  if (item.source === 'drive') return { nextItem: item, status: 'skipped', reason: 'drive' }
  if (item.source === 'storage' && isAbsoluteUrl(item.path)) {
    return { nextItem: item, status: 'skipped', reason: 'already-blob' }
  }

  if (item.source === 'storage' && item.path) {
    const relativePath = String(item.path).replace(/^\/+/, '')
    const fullPath = path.join(mediaRoot, relativePath)
    const buffer = await fs.readFile(fullPath)
    const blobUrl = await uploadBufferToBlob(`media/${relativePath}`, buffer, inferContentType(item, relativePath))
    return {
      nextItem: { ...item, source: 'storage', path: blobUrl },
      status: 'migrated',
      from: relativePath,
      to: blobUrl,
    }
  }

  if (item.data && String(item.data).startsWith('data:')) {
    const { mime, buffer } = dataUriToBuffer(item.data)
    const ext = item.type === 'video'
      ? 'mp4'
      : mime === 'image/png'
        ? 'png'
        : mime === 'image/webp'
          ? 'webp'
          : 'jpg'
    const blobPath = `media/${customerId}/migrated-${Date.now()}-${index}.${ext}`
    const blobUrl = await uploadBufferToBlob(blobPath, buffer, mime)
    return {
      nextItem: { type: item.type || 'image', source: 'storage', path: blobUrl },
      status: 'migrated',
      from: 'data-uri',
      to: blobUrl,
    }
  }

  if (item.data && isAbsoluteUrl(item.data)) {
    return {
      nextItem: { ...item, source: item.source || 'storage', path: item.path || item.data },
      status: 'skipped',
      reason: 'external-url',
    }
  }

  return { nextItem: item, status: 'skipped', reason: 'unsupported' }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })

  const pool = await new mssql.ConnectionPool(connectionString).connect()
  const startedAt = new Date().toISOString()
  const report = {
    startedAt,
    database: sqlServerDatabase,
    migratedCustomers: 0,
    migratedItems: 0,
    skippedItems: 0,
    failedItems: 0,
    customers: [],
  }

  try {
    const result = await pool.request().query(`
      SELECT id, ticketId, name, media
      FROM dbo.customers
      WHERE media IS NOT NULL
    `)

    for (const row of result.recordset) {
      const originalMedia = normalizeMedia(row.media)
      if (!originalMedia.length) continue

      const customerReport = {
        id: row.id,
        ticketId: row.ticketId,
        name: row.name,
        items: [],
      }

      const nextMedia = []
      let hasChanges = false

      for (let index = 0; index < originalMedia.length; index += 1) {
        const item = originalMedia[index]
        try {
          const migrated = await migrateMediaItem(row.id, item, index)
          nextMedia.push(migrated.nextItem)
          customerReport.items.push(migrated)
          if (migrated.status === 'migrated') {
            hasChanges = true
            report.migratedItems += 1
          } else {
            report.skippedItems += 1
          }
        } catch (error) {
          nextMedia.push(item)
          customerReport.items.push({
            status: 'failed',
            error: error.message || String(error),
            original: item,
          })
          report.failedItems += 1
        }
      }

      if (hasChanges) {
        await pool.request()
          .input('id', mssql.BigInt, Number(row.id))
          .input('media', mssql.NVarChar(mssql.MAX), JSON.stringify(nextMedia))
          .query(`
            UPDATE dbo.customers
            SET media = @media
            WHERE id = @id
          `)
        report.migratedCustomers += 1
      }

      if (customerReport.items.some((item) => item.status === 'migrated' || item.status === 'failed')) {
        report.customers.push(customerReport)
      }
    }
  } finally {
    await pool.close()
  }

  const finishedAt = new Date().toISOString()
  report.finishedAt = finishedAt

  const reportPath = path.join(outputDir, `media-blob-migration-${finishedAt.replace(/[:.]/g, '-')}.json`)
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

  console.log(`Da migrate ${report.migratedItems} media item cua ${report.migratedCustomers} khach.`)
  console.log(`Skipped: ${report.skippedItems}, Failed: ${report.failedItems}`)
  console.log(`Bao cao: ${reportPath}`)
  console.log('Luu y: file local cu van duoc giu nguyen, script nay khong xoa media cu.')
}

main().catch((error) => {
  console.error('[migrate-media-to-blob]', error)
  process.exit(1)
})
