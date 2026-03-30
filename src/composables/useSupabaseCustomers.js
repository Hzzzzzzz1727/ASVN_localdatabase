// src/composables/useSupabaseCustomers.js
import { ref, onMounted } from 'vue'
import { getSupabase } from '@/lib/supabase'

export function useSupabaseCustomers() {
  const customers = ref([])
  const supabase = getSupabase()
  const isLoading = ref(false)
  const IMAGE_MAX_WIDTH = 1600
  const IMAGE_MAX_HEIGHT = 1600
  const IMAGE_QUALITY = 0.82

  // ── URL public của bucket ─────────────────────────────────
  const BUCKET = 'media'
  const getPublicUrl = (path) => {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return data.publicUrl
  }

  const optimizeImageFile = async (file) => {
    if (!file?.type?.startsWith('image/')) return file
    if (file.size <= 1.5 * 1024 * 1024) return file
    if (typeof document === 'undefined') return file

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })

      const img = await new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = dataUrl
      })

      const ratio = Math.min(
        1,
        IMAGE_MAX_WIDTH / img.width,
        IMAGE_MAX_HEIGHT / img.height
      )
      const width = Math.max(1, Math.round(img.width * ratio))
      const height = Math.max(1, Math.round(img.height * ratio))

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return file
      ctx.drawImage(img, 0, 0, width, height)

      const preferredType = file.type === 'image/png' ? 'image/jpeg' : file.type
      const optimizedBlob = await new Promise((resolve) => {
        canvas.toBlob(
          (blob) => resolve(blob),
          preferredType,
          preferredType === 'image/png' ? undefined : IMAGE_QUALITY
        )
      })

      if (!optimizedBlob || optimizedBlob.size >= file.size) return file

      const ext = preferredType === 'image/png'
        ? 'png'
        : preferredType === 'image/webp'
          ? 'webp'
          : 'jpg'

      return new File(
        [optimizedBlob],
        file.name.replace(/\.[^.]+$/, '') + `_opt.${ext}`,
        { type: preferredType, lastModified: Date.now() }
      )
    } catch (e) {
      console.warn('[Optimize image] Fallback original file:', e)
      return file
    }
  }

  // ── Load danh sách ca (smart merge - không re-render toàn bộ) ─
  const loadData = async () => {
    isLoading.value = true
    try {
      const { data, error } = await supabase
        .from('customers')
        .select(`
          id, ticketId, name, phone, model, address, issue,
          status, replacedPart, doneDate, createdAt,
          folderDrive, warehouse, serial, branch, statusLog, price, lkItems,
          warranty_months, warranty_start_at, warranty_expires_at
        `)
        .order('id', { ascending: false })
        .limit(300)

      if (error) {
        console.error('[Customers] Load error:', error.message)
        return
      }

      const newData = data || []

      if (customers.value.length === 0) {
        customers.value = newData
        return
      }

      const newMap = new Map(newData.map(c => [c.id, c]))
      const toRemove = customers.value.filter(c => !newMap.has(c.id))
      if (toRemove.length) {
        toRemove.forEach(c => {
          const idx = customers.value.findIndex(x => x.id === c.id)
          if (idx !== -1) customers.value.splice(idx, 1)
        })
      }

      newData.forEach(newItem => {
        const idx = customers.value.findIndex(c => c.id === newItem.id)
        if (idx === -1) {
          customers.value.unshift(newItem)
        } else {
          const old = customers.value[idx]
          if (
            old.status !== newItem.status ||
            old.replacedPart !== newItem.replacedPart ||
            old.doneDate !== newItem.doneDate ||
            old.name !== newItem.name ||
            old.price !== newItem.price ||
            old.lkItems?.length !== newItem.lkItems?.length ||
            old.statusLog?.length !== newItem.statusLog?.length ||
            old.warranty_months !== newItem.warranty_months ||
            old.warranty_start_at !== newItem.warranty_start_at ||
            old.warranty_expires_at !== newItem.warranty_expires_at
          ) {
            customers.value[idx] = { ...customers.value[idx], ...newItem }
          }
        }
      })
    } catch (e) {
      if (!e?.message?.includes('aborted')) console.error('[loadData]', e)
    } finally {
      isLoading.value = false
    }
  }

  // ── Load media của 1 ca ───────────────────────────────────
  const loadMediaForItem = async (id) => {
    const { data, error } = await supabase
      .from('customers')
      .select('media')
      .eq('id', id)
      .maybeSingle()
    if (error) { console.error('[Media] Load error:', error.message); return [] }

    const raw = data?.media || []
    return raw.map(m => {
      if (m.source === 'storage' && m.path) {
        return { ...m, data: getPublicUrl(m.path) }
      }
      if (m.path && !m.data) {
        return { ...m, type: m.type || 'image', source: 'storage', data: getPublicUrl(m.path) }
      }
      if (m.data) {
        return { ...m, type: m.type || 'image' }
      }
      if (typeof m === 'string') {
        return { type: 'image', data: m, source: 'local' }
      }
      return null
    }).filter(Boolean)
  }

  const uploadFileToStorage = async (file, customerId) => {
    const processedFile = await optimizeImageFile(file)
    const ext = processedFile.name.split('.').pop() || (processedFile.type.startsWith('video') ? 'mp4' : 'jpg')
    const path = `${customerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, processedFile, {
      cacheControl: '3600',
      upsert: false
    })
    if (error) throw error
    return path
  }

  const deleteFileFromStorage = async (path) => {
    if (!path) return
    await supabase.storage.from(BUCKET).remove([path])
  }

  const migrateBase64ToStorage = async (customerId, mediaArray) => {
    const updated = []
    let hasChanges = false
    for (const m of mediaArray) {
      if (m.source === 'storage' || m.source === 'drive') {
        updated.push(m); continue
      }
      if (m.data && m.data.startsWith('data:')) {
        try {
          const res = await fetch(m.data)
          const blob = await res.blob()
          const ext = m.type === 'video' ? 'mp4' : 'jpg'
          const file = new File([blob], `migrated_${Date.now()}.${ext}`, { type: blob.type })
          const path = await uploadFileToStorage(file, customerId)
          updated.push({ type: m.type, source: 'storage', path })
          hasChanges = true
        } catch (e) {
          console.warn('[Migrate] Lỗi convert:', e)
          updated.push(m)
        }
      } else {
        updated.push(m)
      }
    }
    if (hasChanges) {
      await supabase.from('customers').update({ media: updated }).eq('id', customerId)
    }
    return updated
  }

  const uploadMediaFiles = async (files, customerId, currentMedia) => {
    const newItems = await Promise.all(files.map(async (file) => {
      try {
        const path = await uploadFileToStorage(file, customerId)
        return { type: file.type.startsWith('video') ? 'video' : 'image', source: 'storage', path }
      } catch (e) {
        console.error('[Upload] Lỗi:', e)
        return await new Promise(resolve => {
          const reader = new FileReader()
          reader.onload = () => resolve({
            type: file.type.startsWith('video') ? 'video' : 'image',
            data: reader.result, source: 'local'
          })
          reader.readAsDataURL(file)
        })
      }
    }))
    return [...currentMedia, ...newItems]
  }

  const removeMediaItem = async (mediaArray, index) => {
    const item = mediaArray[index]
    if (item.source === 'storage' && item.path) {
      await deleteFileFromStorage(item.path)
    }
    const updated = [...mediaArray]
    updated.splice(index, 1)
    return updated
  }

  onMounted(() => { loadData() })

  return {
    customers, loadData, loadMediaForItem,
    uploadMediaFiles, removeMediaItem,
    migrateBase64ToStorage, getPublicUrl, isLoading
  }
}
