import { ref } from 'vue'
import { getSupabase } from '@/lib/supabase'

export function useSupabaseCustomers() {
  const customers = ref([])
  const supabase = getSupabase()
  const isLoading = ref(false)
  const hasHydratedCache = ref(false)
  let loadPromise = null
  const CACHE_KEY = 'tv-repair-customers-cache'

  const normalizeCustomer = (customer) => ({
    ...customer,
    statusLog: Array.isArray(customer?.statusLog) ? customer.statusLog : [],
    lkItems: Array.isArray(customer?.lkItems) ? customer.lkItems : [],
    media: normalizeMediaList(customer?.media),
  })

  const normalizeMediaList = (value) => {
    if (value === null || value === undefined || value === '') return []
    if (Array.isArray(value)) return value
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
      } catch {
        return [value]
      }
    }
    return [value]
  }

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

  const loadData = async () => {
    if (loadPromise) return loadPromise

    loadPromise = (async () => {
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

      const currentMap = new Map(customers.value.map((customer) => [customer.id, customer]))
      const nextMap = new Map(newData.map((customer) => [customer.id, customer]))

      customers.value = newData.map((newItem) => {
        const old = currentMap.get(newItem.id)
        if (!old) return newItem
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
          old.warranty_expires_at !== newItem.warranty_expires_at ||
          old.folderDrive !== newItem.folderDrive ||
          old.address !== newItem.address ||
          old.issue !== newItem.issue ||
          old.phone !== newItem.phone ||
          old.model !== newItem.model ||
          old.serial !== newItem.serial ||
          old.branch !== newItem.branch ||
          old.warehouse !== newItem.warehouse
        ) {
          return { ...old, ...newItem }
        }
        return old
      }).filter((item) => nextMap.has(item.id))
    } catch (error) {
      if (!error?.message?.includes('aborted')) console.error('[loadData]', error)
    } finally {
      isLoading.value = false
      loadPromise = null
    }
    })()

    return loadPromise
  }

  const hydrateCache = () => {
    if (typeof window === 'undefined' || hasHydratedCache.value) return
    hasHydratedCache.value = true
    if (customers.value.length) return
    const cached = loadCache()
    if (cached.length) customers.value = cached
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

    const raw = normalizeMediaList(data?.media)
    return raw.map((mediaItem) => {
      if (typeof mediaItem === 'string') {
        return {
          type: 'image',
          source: /^https?:\/\//i.test(mediaItem) ? 'storage' : 'local',
          data: /^https?:\/\//i.test(mediaItem) ? mediaItem : getPublicUrl(mediaItem),
        }
      }
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
    const ext = file.name.split('.').pop() || (file.type.startsWith('video') ? 'mp4' : 'jpg')
    const filePath = `${customerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { data, error } = await supabase.storage.from(BUCKET).upload(filePath, file, {
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
        return {
          type: file.type.startsWith('video') ? 'video' : 'image',
          source: 'storage',
          path: filePath,
          data: getPublicUrl(filePath),
        }
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

  return {
    customers,
    loadData,
    hydrateCache,
    loadMediaForItem,
    uploadMediaFiles,
    removeMediaItem,
    migrateBase64ToStorage,
    getPublicUrl,
    isLoading,
  }
}
