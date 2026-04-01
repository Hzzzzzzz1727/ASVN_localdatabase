import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const rootDir = process.cwd()
const mediaRoot = path.join(rootDir, 'local-media', 'media')
const bucket = process.env.SUPABASE_MEDIA_BUCKET || 'media'
const supabaseUrl = process.env.SUPABASE_URL || 'https://aitgsajahebfyppfxkxi.supabase.co'
const supabaseKey = process.env.SUPABASE_ANON_KEY
const pageSize = Number(process.env.SUPABASE_MEDIA_PAGE_SIZE || 100)

if (!supabaseKey) {
  console.error('Thieu SUPABASE_ANON_KEY hoac service role key.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function listRecursive(prefix = '') {
  const collected = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw error
    if (!data?.length) break

    for (const item of data) {
      const itemPath = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) {
        collected.push(...await listRecursive(itemPath))
      } else {
        collected.push(itemPath)
      }
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  return collected
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function downloadObject(objectPath) {
  const targetPath = path.join(mediaRoot, ...objectPath.split('/'))
  await ensureDir(path.dirname(targetPath))

  if (await fileExists(targetPath)) {
    return { objectPath, targetPath, skipped: true }
  }

  const { data, error } = await supabase.storage.from(bucket).download(objectPath)
  if (error) throw error

  const buffer = Buffer.from(await data.arrayBuffer())
  await fs.writeFile(targetPath, buffer)
  return { objectPath, targetPath, skipped: false, bytes: buffer.length }
}

async function main() {
  await ensureDir(mediaRoot)
  const objects = await listRecursive('')

  let downloaded = 0
  let skipped = 0
  let failed = 0

  console.log(`Tim thay ${objects.length} file trong bucket '${bucket}'.`)

  for (const objectPath of objects) {
    try {
      const result = await downloadObject(objectPath)
      if (result.skipped) {
        skipped += 1
        console.log(`SKIP ${objectPath}`)
      } else {
        downloaded += 1
        console.log(`DOWN ${objectPath}`)
      }
    } catch (error) {
      failed += 1
      console.error(`FAIL ${objectPath}: ${error.message || error}`)
    }
  }

  console.log(`Hoan tat. downloaded=${downloaded}, skipped=${skipped}, failed=${failed}`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
