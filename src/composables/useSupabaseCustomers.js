import { ref, onMounted } from 'vue'
import { getSupabase } from '@/lib/supabase'

export function useSupabaseCustomers() {
  const customers = ref([])
  const supabase = getSupabase()
  const isLoading = ref(false)
  const CACHE_KEY = 'tv-repair-customers-cache'
  const IMAGE_MAX_WIDTH = 1600
  const IMAGE_MAX_HEIGHT = 1600
  const IMAGE_QUALITY = 0.82

  const normalizeCustomer = (customer) => ({
    ...customer,
    statusLog: Array.isArray(customer?.statusLog) ? customer.statusLog : [],
    lkItems: Array.isArray(customer?.lkItems) ? customer.lkItems : [],
    media: Array.isArray(customer?.media) ? customer.media : [],
  })

  const loadCache = () => {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(normalizeCustomer) : []
    } catch {
      return []
    }
  }

  const saveCache = (items) => {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(items))
    } catch {}
  }

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
        IMAGE_MAX_HEIGHT / img.height,
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
          preferredType === 'image/png' ? undefined : IMAGE_QUALITY,
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
        { type: preferredType, lastModified: Date.now() },
      )
    } catch (error) {
      console.warn('[Optimize image] Fallback original file:', error)
      return file
    }
  }

  const loadData = async () => {
    isLoading.value = true
    try {
      const { data, error } = await supabase
        .from('customers')
        .select(`
          id, ticketId, name, phone, model, address, issue,
          status, replacedPart, doneDate, createdAt, note,
          folderDrive, warehouse, serial, branch, statusLog, price, lkItems,
          warranty_months, warranty_start_at, warranty_expires_at
        `)
        .order('id', { ascending: false })
        .limit(300)

      if (error) {
        console.error('[Customers] Load error:', error.message)
        return
      }

      const newData = (data || []).map(normalizeCustomer)
      saveCache(newData)

      if (customers.value.length === 0) {
        customers.value = newData
        return
      }

      const newMap = new Map(newData.map((customer) => [customer.id, customer]))
      const toRemove = customers.value.filter((customer) => !newMap.has(customer.id))
      if (toRemove.length) {
        toRemove.forEach((customer) => {
          const index = customers.value.findIndex((item) => item.id === customer.id)
          if (index !== -1) customers.value.splice(index, 1)
        })
      }

      newData.forEach((newItem) => {
        const index = customers.value.findIndex((customer) => customer.id === newItem.id)
        if (index === -1) {
          customers.value.unshift(newItem)
          return
        }

        const old = customers.value[index]
        if (
          old.status !== newItem.status ||
          old.replacedPart !== newItem.replacedPart ||
          old.doneDate !== newItem.doneDate ||
          old.note !== newItem.note ||
          old.name !== newItem.name ||
          old.price !== newItem.price ||
          old.lkItems?.length !== newItem.lkItems?.length ||
          old.statusLog?.length !== newItem.statusLog?.length ||
          old.warranty_months !== newItem.warranty_months ||
          old.warranty_start_at !== newItem.warranty_start_at ||
          old.warranty_expires_at !== newItem.warranty_expires_at
        ) {
          customers.value[index] = { ...customers.value[index], ...newItem }
        }
      })
    } catch (error) {
      if (!error?.message?.includes('aborted')) console.error('[loadData]', error)
    } finally {
      isLoading.value = false
    }
  }

  const loadMediaForItem = async (id) => {
    const { data, error } = await supabase
      .from('customers')
      .select('media')
      .eq('id', id)
      .maybeSingle()
    if (error) {
      console.error('[Media] Load error:', error.message)
      return []
    }

    const raw = Array.isArray(data?.media) ? data.media : []
    return raw.map((mediaItem) => {
      if (mediaItem?.source === 'storage' && mediaItem?.path) {
        return { ...mediaItem, data: getPublicUrl(mediaItem.path) }
      }
      if (mediaItem?.path && !mediaItem?.data) {
        return {
          ...mediaItem,
          type: mediaItem.type || 'image',
          source: 'storage',
          data: getPublicUrl(mediaItem.path),
        }
      }
      if (mediaItem?.data) {
        return { ...mediaItem, type: mediaItem.type || 'image' }
      }
      if (typeof mediaItem === 'string') {
        return { type: 'image', data: mediaItem, source: 'local' }
      }
      return null
    }).filter(Boolean)
  }

  const uploadFileToStorage = async (file, customerId) => {
    const processedFile = await optimizeImageFile(file)
    const ext = processedFile.name.split('.').pop() || (processedFile.type.startsWith('video') ? 'mp4' : 'jpg')
    const filePath = `${customerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { data, error } = await supabase.storage.from(BUCKET).upload(filePath, processedFile, {
      cacheControl: '3600',
      upsert: false,
    })
    if (error) throw error
    return data?.path || filePath
  }

  const deleteFileFromStorage = async (filePath) => {
    if (!filePath) return
    await supabase.storage.from(BUCKET).remove([filePath])
  }

  const migrateBase64ToStorage = async (customerId, mediaArray) => {
    const updated = []
    let hasChanges = false

    for (const mediaItem of mediaArray) {
      if (mediaItem.source === 'storage' || mediaItem.source === 'drive') {
        updated.push(mediaItem)
        continue
      }

      if (mediaItem.data && mediaItem.data.startsWith('data:')) {
        try {
          const response = await fetch(mediaItem.data)
          const blob = await response.blob()
          const ext = mediaItem.type === 'video' ? 'mp4' : 'jpg'
          const file = new File([blob], `migrated_${Date.now()}.${ext}`, { type: blob.type })
          const filePath = await uploadFileToStorage(file, customerId)
          updated.push({ type: mediaItem.type, source: 'storage', path: filePath })
          hasChanges = true
        } catch (error) {
          console.warn('[Migrate] Loi convert:', error)
          updated.push(mediaItem)
        }
      } else {
        updated.push(mediaItem)
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
        const filePath = await uploadFileToStorage(file, customerId)
        return { type: file.type.startsWith('video') ? 'video' : 'image', source: 'storage', path: filePath }
      } catch (error) {
        console.error('[Upload] Loi:', error)
        return await new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve({
            type: file.type.startsWith('video') ? 'video' : 'image',
            data: reader.result,
            source: 'local',
          })
          reader.readAsDataURL(file)
        })
      }
    }))

    return [...currentMedia, ...newItems]
  }

  const removeMediaItem = async (mediaArray, index) => {
    const item = mediaArray[index]
    if (item?.source === 'storage' && item?.path) {
      await deleteFileFromStorage(item.path)
    }
    const updated = [...mediaArray]
    updated.splice(index, 1)
    return updated
  }

  onMounted(() => {
    if (typeof window !== 'undefined' && customers.value.length === 0) {
      const cached = loadCache()
      if (cached.length) customers.value = cached
    }
    loadData()
  })

  return {
    customers,
    loadData,
    loadMediaForItem,
    uploadMediaFiles,
    removeMediaItem,
    migrateBase64ToStorage,
    getPublicUrl,
    isLoading,
  }
}
