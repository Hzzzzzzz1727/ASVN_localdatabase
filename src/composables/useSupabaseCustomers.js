// src/composables/useSupabaseCustomers.js
import { ref, onMounted } from 'vue'
import { getSupabase } from '@/lib/supabase'

export function useSupabaseCustomers() {
  const customers = ref([])
  const supabase = getSupabase()
  const isLoading = ref(false)

  // ── URL public của bucket ─────────────────────────────────
  const BUCKET = 'media'
  const getPublicUrl = (path) => {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return data.publicUrl
  }

  // ── Load danh sách ca (không load media) ─────────────────
  const loadData = async () => {
    isLoading.value = true
    const { data, error } = await supabase
      .from('customers')
      .select(`
        id, ticketId, name, phone, model, address, issue,
        status, replacedPart, doneDate, createdAt,
        folderDrive, warehouse, serial, branch
      `)
      .order('id', { ascending: false })
      .limit(300)
    if (error) {
      console.error('[Customers] Load error:', error.message)
    } else {
      customers.value = data || []
    }
    isLoading.value = false
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
      // Format mới có source:'storage'
      if (m.source === 'storage' && m.path) {
        return { ...m, data: getPublicUrl(m.path) }
      }
      // Format mới KHÔNG có source nhưng có path (upload từ code mới)
      if (m.path && !m.data) {
        return { ...m, type: m.type || 'image', source: 'storage', data: getPublicUrl(m.path) }
      }
      // Format cũ: có data base64 hoặc drive url
      if (m.data) {
        return { ...m, type: m.type || 'image' }
      }
      // Format string thẳng
      if (typeof m === 'string') {
        return { type: 'image', data: m, source: 'local' }
      }
      return null
    }).filter(Boolean)
  }

  // ── Upload file lên Storage ───────────────────────────────
  const uploadFileToStorage = async (file, customerId) => {
    const ext = file.name.split('.').pop() || (file.type.startsWith('video') ? 'mp4' : 'jpg')
    const path = `${customerId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false
    })
    if (error) throw error
    return path
  }

  // ── Xóa file khỏi Storage ────────────────────────────────
  const deleteFileFromStorage = async (path) => {
    if (!path) return
    await supabase.storage.from(BUCKET).remove([path])
  }

  // ── Migrate base64 cũ sang Storage (chạy nền) ────────────
  // Gọi hàm này 1 lần để convert tất cả ảnh cũ
  const migrateBase64ToStorage = async (customerId, mediaArray) => {
    const updated = []
    let hasChanges = false

    for (const m of mediaArray) {
      // Bỏ qua nếu đã là storage hoặc là drive link
      if (m.source === 'storage' || m.source === 'drive') {
        updated.push(m)
        continue
      }
      // Nếu là base64 → convert sang file rồi upload
      if (m.data && m.data.startsWith('data:')) {
        try {
          // Convert base64 → Blob
          const res = await fetch(m.data)
          const blob = await res.blob()
          const ext = m.type === 'video' ? 'mp4' : 'jpg'
          const file = new File([blob], `migrated_${Date.now()}.${ext}`, { type: blob.type })
          const path = await uploadFileToStorage(file, customerId)
          updated.push({ type: m.type, source: 'storage', path })
          hasChanges = true
        } catch (e) {
          console.warn('[Migrate] Lỗi convert:', e)
          updated.push(m) // giữ base64 nếu lỗi
        }
      } else {
        updated.push(m)
      }
    }

    if (hasChanges) {
      // Lưu lại array đã migrate vào DB
      await supabase.from('customers').update({ media: updated }).eq('id', customerId)
    }
    return updated
  }

  // ── Upload ảnh/video mới (từ file input) ──────────────────
  const uploadMediaFiles = async (files, customerId, currentMedia) => {
    const newItems = await Promise.all(files.map(async (file) => {
      try {
        const path = await uploadFileToStorage(file, customerId)
        return {
          type: file.type.startsWith('video') ? 'video' : 'image',
          source: 'storage',
          path
        }
      } catch (e) {
        console.error('[Upload] Lỗi:', e)
        // Fallback base64 nếu upload Storage lỗi
        return await new Promise(resolve => {
          const reader = new FileReader()
          reader.onload = () => resolve({
            type: file.type.startsWith('video') ? 'video' : 'image',
            data: reader.result,
            source: 'local'
          })
          reader.readAsDataURL(file)
        })
      }
    }))
    return [...currentMedia, ...newItems]
  }

  // ── Xóa 1 media item ─────────────────────────────────────
  const removeMediaItem = async (mediaArray, index) => {
    const item = mediaArray[index]
    // Nếu là storage → xóa file thật
    if (item.source === 'storage' && item.path) {
      await deleteFileFromStorage(item.path)
    }
    const updated = [...mediaArray]
    updated.splice(index, 1)
    return updated
  }

  onMounted(() => { loadData() })

  return {
    customers,
    loadData,
    loadMediaForItem,
    uploadMediaFiles,
    removeMediaItem,
    migrateBase64ToStorage,
    getPublicUrl,
    isLoading
  }
}