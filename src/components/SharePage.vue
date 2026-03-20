<script setup>
import { ref, onMounted } from 'vue'
import { getSupabase } from '@/lib/supabase'

const supabase = getSupabase()
const customer = ref(null)
const media    = ref([])
const loading  = ref(true)
const error    = ref('')

const BUCKET = 'media'
const getPublicUrl = (path) => {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

const resolveMedia = (raw) => {
  return (raw || []).map(m => {
    if (!m) return null
    if (m.source === 'storage' && m.path) return { ...m, url: getPublicUrl(m.path) }
    if (m.path && !m.data)               return { ...m, url: getPublicUrl(m.path), type: m.type || 'image' }
    if (m.data && !m.data.startsWith('data:')) return { ...m, url: m.data }
    if (m.data)                          return { ...m, url: m.data } // base64 fallback
    return null
  }).filter(Boolean)
}

const formatDate = (s) => {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
}
const formatPrice = (n) => n ? Number(n).toLocaleString('vi-VN') + 'đ' : '0đ'

const downloadFile = async (url, filename) => {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  } catch {
    window.open(url, '_blank')
  }
}

const downloadAll = async () => {
  const storageMedia = media.value.filter(m => !m.url?.startsWith('data:'))
  for (let i = 0; i < storageMedia.length; i++) {
    const m = storageMedia[i]
    const ext = m.type === 'video' ? 'mp4' : 'jpg'
    await downloadFile(m.url, `${customer.value.ticketId}_${i + 1}.${ext}`)
    await new Promise(r => setTimeout(r, 400))
  }
}

onMounted(async () => {
  const params = new URLSearchParams(location.search)
  const id = params.get('id')
  if (!id) { error.value = 'Không tìm thấy mã ca!'; loading.value = false; return }

  const { data, error: err } = await supabase
    .from('customers')
    .select('id, ticketId, name, phone, model, address, issue, serial, replacedPart, price, lkItems, status, doneDate, createdAt, warehouse, media')
    .eq('id', id)
    .maybeSingle()

  if (err || !data) { error.value = 'Không tìm thấy ca này!'; loading.value = false; return }
  customer.value = data
  media.value = resolveMedia(data.media)
  loading.value = false
})
</script>

<template>
  <div class="share-page">
    <div class="share-header">
      <span class="share-logo">📺 TV Repair</span>
      <span class="share-sub">Thông tin ca sửa chữa</span>
    </div>

    <div v-if="loading" class="share-loading">
      <div class="spinner-border text-primary"></div>
      <p>Đang tải...</p>
    </div>

    <div v-else-if="error" class="share-error">{{ error }}</div>

    <div v-else-if="customer" class="share-body">
      <!-- Info card -->
      <div class="info-card">
        <div class="info-header">
          <span class="ticket-id">{{ customer.ticketId }}</span>
          <span :class="['status-badge', customer.status===0?'s-blue':customer.status===1?'s-yellow':'s-green']">
            {{ customer.status===0?'Đang làm':customer.status===1?'Chờ linh kiện':'Hoàn thành' }}
          </span>
        </div>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">👤 Khách hàng</span><span class="info-val fw">{{ customer.name }}</span></div>
          <div class="info-row"><span class="info-label">📞 SĐT</span><a :href="'tel:'+customer.phone" class="info-val fw link">{{ customer.phone }}</a></div>
          <div class="info-row"><span class="info-label">📺 Model</span><span class="info-val">{{ customer.model }}</span></div>
          <div v-if="customer.serial" class="info-row"><span class="info-label">🔢 Serial</span><span class="info-val">{{ customer.serial }}</span></div>
          <div v-if="customer.warehouse" class="info-row"><span class="info-label">🏭 Kho</span><span class="info-val">{{ customer.warehouse }}</span></div>
          <div v-if="customer.address && customer.address !== 'Ca ngoài - không có địa chỉ'" class="info-row">
            <span class="info-label">📍 Địa chỉ</span><span class="info-val">{{ customer.address }}</span>
          </div>
          <div class="info-row"><span class="info-label">⚠️ Lỗi</span><span class="info-val fw danger">{{ customer.issue }}</span></div>
          <div v-if="customer.replacedPart && customer.replacedPart !== 'Chưa có'" class="info-row">
            <span class="info-label">🔧 Linh kiện</span><span class="info-val">{{ customer.replacedPart }}</span>
          </div>
          <div class="info-row"><span class="info-label">📅 Ngày tạo</span><span class="info-val">{{ formatDate(customer.createdAt) }}</span></div>
          <div v-if="customer.doneDate" class="info-row"><span class="info-label">✅ Hoàn thành</span><span class="info-val fw">{{ customer.doneDate }}</span></div>
        </div>

        <!-- Linh kiện có giá -->
        <div v-if="customer.lkItems?.length" class="lk-section">
          <div class="lk-title">💰 Chi tiết phí sửa chữa</div>
          <div v-for="lk in customer.lkItems" :key="lk.name" class="lk-row">
            <span>🔩 {{ lk.name }}</span>
            <span class="lk-price">{{ formatPrice(lk.price) }}</span>
          </div>
          <div class="lk-total">
            <span>Tổng phí</span>
            <span>{{ formatPrice(customer.price) }}</span>
          </div>
        </div>
        <div v-else-if="customer.price" class="lk-section">
          <div class="lk-total">
            <span>💰 Tổng phí sửa chữa</span>
            <span>{{ formatPrice(customer.price) }}</span>
          </div>
        </div>
      </div>

      <!-- Media section -->
      <div v-if="media.length" class="media-section">
        <div class="media-header">
          <span class="media-title">🖼️ Ảnh & Video ({{ media.length }} file)</span>
          <button @click="downloadAll" class="btn-dl-all">⬇️ Tải tất cả</button>
        </div>
        <div class="media-grid">
          <div v-for="(m, i) in media" :key="i" class="media-item">
            <img v-if="m.type !== 'video'" :src="m.url" class="media-thumb"
              @click="window.open(m.url,'_blank')" alt="Ảnh">
            <video v-else :src="m.url" controls class="media-thumb"></video>
            <button @click="downloadFile(m.url, `${customer.ticketId}_${i+1}.${m.type==='video'?'mp4':'jpg'}`)"
              class="btn-dl">⬇️ Tải về</button>
          </div>
        </div>
      </div>
      <div v-else class="no-media">Không có ảnh/video</div>
    </div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }
.share-page { min-height: 100vh; background: #f1f5f9; font-family: system-ui, sans-serif; }
.share-header { background: #1e293b; color: #fff; padding: 1rem 1.5rem; display: flex; align-items: center; gap: 1rem; }
.share-logo { font-weight: 800; font-size: 1.1rem; }
.share-sub { color: #94a3b8; font-size: 0.85rem; }
.share-loading { display: flex; flex-direction: column; align-items: center; padding: 4rem; gap: 1rem; color: #64748b; }
.share-error { text-align: center; padding: 4rem; color: #ef4444; font-size: 1.1rem; }
.share-body { max-width: 700px; margin: 0 auto; padding: 1.5rem 1rem; display: flex; flex-direction: column; gap: 1.25rem; }
.info-card { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.info-header { display: flex; align-items: center; gap: 1rem; padding: 1rem 1.25rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.ticket-id { font-weight: 800; font-size: 1.1rem; color: #1e293b; }
.status-badge { padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.78rem; font-weight: 700; }
.s-blue   { background: #dbeafe; color: #1d4ed8; }
.s-yellow { background: #fef3c7; color: #92400e; }
.s-green  { background: #d1fae5; color: #065f46; }
.info-grid { padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
.info-row { display: flex; gap: 0.75rem; align-items: flex-start; }
.info-label { min-width: 120px; font-size: 0.82rem; color: #64748b; padding-top: 0.1rem; }
.info-val { flex: 1; font-size: 0.92rem; color: #1e293b; }
.info-val.fw { font-weight: 700; }
.info-val.danger { color: #ef4444; font-weight: 700; }
.info-val.link { color: #3b82f6; text-decoration: none; }
.lk-section { margin: 0 1.25rem 1rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 0.75rem 1rem; }
.lk-title { font-weight: 700; font-size: 0.9rem; color: #065f46; margin-bottom: 0.5rem; }
.lk-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.25rem 0; border-bottom: 1px solid #dcfce7; }
.lk-price { font-weight: 600; color: #16a34a; }
.lk-total { display: flex; justify-content: space-between; font-weight: 800; font-size: 0.95rem; color: #065f46; padding-top: 0.5rem; border-top: 2px solid #86efac; margin-top: 0.25rem; }
.media-section { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.media-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid #e2e8f0; }
.media-title { font-weight: 700; color: #1e293b; }
.btn-dl-all { background: #3b82f6; color: #fff; border: none; border-radius: 8px; padding: 0.4rem 1rem; font-weight: 600; cursor: pointer; font-size: 0.85rem; }
.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; padding: 1.25rem; }
.media-item { display: flex; flex-direction: column; gap: 0.4rem; }
.media-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; cursor: pointer; background: #f1f5f9; }
.btn-dl { background: #1e293b; color: #fff; border: none; border-radius: 6px; padding: 0.35rem; font-size: 0.78rem; font-weight: 600; cursor: pointer; width: 100%; }
.btn-dl:hover { background: #334155; }
.no-media { background: #fff; border-radius: 16px; padding: 2rem; text-align: center; color: #94a3b8; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
@media (max-width: 480px) {
  .info-label { min-width: 100px; }
  .media-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>