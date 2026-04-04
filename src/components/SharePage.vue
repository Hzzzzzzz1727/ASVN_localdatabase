<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getPublicShareSupabase } from '@/lib/publicShareSupabase'

const supabase = getPublicShareSupabase()

const loading = ref(true)
const error = ref('')
const sharePayload = ref(null)
const shareUpdatedAt = ref('')
const activeMedia = ref(null)

const customer = computed(() => sharePayload.value || null)
const customerMedia = computed(() => Array.isArray(customer.value?.media) ? customer.value.media : [])
const returnToUrl = computed(() => {
  const params = new URLSearchParams(location.search)
  return params.get('returnTo')?.trim() || ''
})
let refreshTimer = null

const DETAIL_ICONS = {
  customer: 'Nguoi',
  phone: 'Goi',
  model: 'TV',
  serial: 'SN',
  issue: 'Loi',
  part: 'LK',
  address: 'Dia',
  created: 'Tao',
  done: 'Xong',
  package: 'BH',
  start: 'BD',
  expires: 'HH',
  state: 'TT',
  price: 'Phi',
  total: 'Tong',
}

const STATUS_LABEL = {
  0: 'Đang làm',
  1: 'Chờ linh kiện',
  2: 'Hoàn thành',
}

const parseMaybeJsonDate = (value) => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const match = value.match(/^\/Date\((\-?\d+)(?:[+-]\d+)?\)\/$/)
    if (match) {
      const parsed = new Date(Number(match[1]))
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatDateTime = (value) => {
  if (!value) return ''
  const date = parseMaybeJsonDate(value)
  if (!date) return value
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatPrice = (value) => {
  const amount = Number(value || 0)
  return amount > 0 ? `${amount.toLocaleString('vi-VN')}d` : '0d'
}

const formatDateOnly = (value) => {
  if (!value) return ''
  const date = parseMaybeJsonDate(value)
  if (!date) return value
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const openMediaViewer = (item) => {
  if (!item?.data) return
  activeMedia.value = item
  document.body.style.overflow = 'hidden'
}

const closeMediaViewer = () => {
  activeMedia.value = null
  document.body.style.overflow = ''
}

const goBack = () => {
  if (returnToUrl.value) {
    window.location.href = returnToUrl.value
    return
  }
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  window.location.href = '/index.html'
}

const loadPublicShare = async ({ silent = false } = {}) => {
  if (!silent || !sharePayload.value) loading.value = true
  if (!silent) error.value = ''

  try {
    const params = new URLSearchParams(location.search)
    const token = params.get('token')?.trim()

    if (!token || token.length < 24) {
      throw new Error('Link xem không hợp lệ hoặc đã hết hạn.')
    }

    const { data, error: rpcError } = await supabase.rpc('get_public_customer_share', {
      p_token: token,
    })

    if (rpcError) throw rpcError

    const row = Array.isArray(data) ? data[0] : data
    const payload = row?.public_payload

    if (!payload || typeof payload !== 'object') {
      throw new Error('Không tìm thấy dữ liệu chia sẻ cho ca này.')
    }

    sharePayload.value = payload
    shareUpdatedAt.value = row?.updated_at || ''
  } catch (err) {
    console.error('[SharePage]', err)
    if (!silent || !sharePayload.value) {
      error.value = err?.message || 'Không mở được link xem này.'
    }
  } finally {
    if (!silent || !sharePayload.value) loading.value = false
  }
}

onMounted(() => {
  loadPublicShare()
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') loadPublicShare({ silent: true })
  }, 5000)
})

onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="share-view">
    <div class="share-shell">
      <div class="hero-card">
        <div class="hero-brand">
          <div class="hero-logo">TV</div>
          <div>
            <div class="hero-title">THÔNG TIN CA</div>
          </div>
        </div>
        <div class="hero-actions">
          <button type="button" class="hero-back" @click="goBack">← Quay lại</button>
          <div class="hero-note">Không có quyền sửa đổi dữ liệu</div>
        </div>
      </div>

      <div v-if="loading" class="state-card">
        <div class="loader-ring" aria-hidden="true"></div>
        <p>Đang tải thông tin ca...</p>
      </div>

      <div v-else-if="error" class="state-card state-card--error">
        <p>{{ error }}</p>
      </div>

      <div v-else-if="customer" class="content-stack">
        <section class="detail-card">
          <div class="detail-header">
            <div>
              <div class="ticket-id">{{ customer.ticketId || 'Không rõ mã ca' }}</div>
              <div class="updated-at" v-if="shareUpdatedAt">Cập nhật: {{ formatDateTime(shareUpdatedAt) }}</div>
            </div>
            <div :class="['status-pill', `status-pill--${customer.status ?? 0}`]">
              {{ STATUS_LABEL[customer.status ?? 0] || 'Đang cập nhật' }}
            </div>
          </div>

          <div class="detail-grid">
            <div class="detail-row">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.customer }}</span>Khách hàng</span>
              <span class="detail-value detail-value--strong">{{ customer.name || 'Đang cập nhật' }}</span>
            </div>
            <div class="detail-row" v-if="customer.phone">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.phone }}</span>Số điện thoại</span>
              <a :href="`tel:${customer.phone}`" class="detail-value detail-link">{{ customer.phone }}</a>
            </div>
            <div class="detail-row" v-if="customer.model">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.model }}</span>Model</span>
              <span class="detail-value">{{ customer.model }}</span>
            </div>
            <div class="detail-row" v-if="customer.serial">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.serial }}</span>Serial</span>
              <span class="detail-value">{{ customer.serial }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.issue }}</span>Tình trạng</span>
              <span class="detail-value detail-value--danger">{{ customer.issue || 'Đang cập nhật' }}</span>
            </div>
            <div class="detail-row" v-if="customer.note">
              <span class="detail-label">Ghi chú</span>
              <span class="detail-value">{{ customer.note }}</span>
            </div>
            <div class="detail-row" v-if="customer.replacedPart">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.part }}</span>Linh kiện</span>
              <span class="detail-value">{{ customer.replacedPart }}</span>
            </div>
            <div class="detail-row" v-if="customer.address">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.address }}</span>Địa chỉ</span>
              <span class="detail-value">{{ customer.address }}</span>
            </div>
            <div class="detail-row" v-if="customer.createdAt">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.created }}</span>Ngày tạo</span>
              <span class="detail-value">{{ formatDateTime(customer.createdAt) }}</span>
            </div>
            <div class="detail-row" v-if="customer.doneDate">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.done }}</span>Ngày hoàn thành</span>
              <span class="detail-value">{{ formatDateOnly(customer.doneDate) }}</span>
            </div>
          </div>
        </section>

        <section v-if="customerMedia.length" class="detail-card detail-card--soft">
          <div class="section-title">Ảnh & Video</div>
          <div class="share-media-grid">
            <div v-for="(item, index) in customerMedia" :key="`${item.type}-${index}`" class="share-media-item">
              <button type="button" class="share-media-button" @click="openMediaViewer(item)">
                <video v-if="item.type === 'video'" :src="item.data" preload="metadata" muted playsinline></video>
                <img v-else :src="item.data" alt="Anh sua chua" loading="lazy">
                <span class="share-media-badge">{{ item.type === 'video' ? 'Video' : 'Anh' }}</span>
              </button>
            </div>
          </div>
        </section>

        <section v-if="customer.lkItems?.length || customer.price" class="detail-card detail-card--soft">
          <div class="section-title"><span class="section-icon">{{ DETAIL_ICONS.price }}</span>Phí sửa chữa</div>
          <div v-if="customer.lkItems?.length" class="price-list">
            <div v-for="(item, index) in customer.lkItems" :key="`${item.name}-${index}`" class="price-row">
              <span>{{ item.name }}</span>
              <strong>{{ formatPrice(item.price) }}</strong>
            </div>
          </div>
          <div class="total-row">
            <span><span class="section-icon section-icon--small">{{ DETAIL_ICONS.total }}</span>Tổng phí</span>
            <strong>{{ formatPrice(customer.price) }}</strong>
          </div>
        </section>

        <section v-if="customer.warranty_label || customer.warranty_expires_at" class="detail-card detail-card--soft">
          <div class="section-title"><span class="section-icon">{{ DETAIL_ICONS.package }}</span>Bảo hành</div>
          <div class="detail-grid">
            <div class="detail-row" v-if="customer.warranty_label">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.package }}</span>Gói</span>
              <span class="detail-value">{{ customer.warranty_label }}</span>
            </div>
            <div class="detail-row" v-if="customer.warranty_start_at">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.start }}</span>Bắt đầu</span>
              <span class="detail-value">{{ formatDateTime(customer.warranty_start_at) }}</span>
            </div>
            <div class="detail-row" v-if="customer.warranty_expires_at">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.expires }}</span>Hết hạn</span>
              <span class="detail-value">{{ formatDateTime(customer.warranty_expires_at) }}</span>
            </div>
            <div class="detail-row" v-if="customer.warranty_remaining_text">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.state }}</span>Trạng thái</span>
              <span class="detail-value">{{ customer.warranty_remaining_text }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div v-if="activeMedia" class="media-viewer" @click="closeMediaViewer">
      <button type="button" class="media-viewer-close" @click.stop="closeMediaViewer">Đóng</button>
      <div class="media-viewer-inner" @click.stop>
        <video
          v-if="activeMedia.type === 'video'"
          :src="activeMedia.data"
          controls
          autoplay
          playsinline
          class="media-viewer-content"
        ></video>
        <img
          v-else
          :src="activeMedia.data"
          alt="Ảnh sửa chữa phóng to"
          class="media-viewer-content"
        >
        <a
          v-if="activeMedia?.data"
          class="media-viewer-download"
          :href="activeMedia.data"
          target="_blank"
          rel="noopener noreferrer"
          download
        >
          Tải xuống
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
:global(body) {
  margin: 0;
  background:
    radial-gradient(circle at top left, rgba(14, 165, 233, 0.16), transparent 28%),
    radial-gradient(circle at top right, rgba(34, 197, 94, 0.14), transparent 24%),
    linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
  color: #10233f;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
}

* {
  box-sizing: border-box;
}

.share-view {
  min-height: 100vh;
  padding: 24px 16px 48px;
}

.share-shell {
  max-width: 820px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.hero-card,
.detail-card,
.state-card {
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.hero-card {
  padding: 22px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.hero-brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.hero-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.hero-logo {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 1.25rem;
  background: linear-gradient(135deg, #0f766e, #2563eb);
  color: #fff;
}

.hero-title {
  font-size: 1.3rem;
  font-weight: 800;
}

.hero-back {
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.92);
  color: #0f172a;
  border-radius: 999px;
  padding: 10px 16px;
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.hero-back:hover {
  background: #eff6ff;
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.12);
  transform: translateY(-1px);
}

.hero-subtitle,
.hero-note,
.updated-at {
  color: #5b6b84;
  font-size: 0.92rem;
}

.state-card {
  padding: 32px 20px;
  text-align: center;
}

.loader-ring {
  width: 44px;
  height: 44px;
  margin: 0 auto 12px;
  border-radius: 50%;
  border: 4px solid rgba(37, 99, 235, 0.18);
  border-top-color: #2563eb;
  animation: spin 0.9s linear infinite;
}

.state-card--error {
  color: #b42318;
}

.content-stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.detail-card {
  padding: 24px;
}

.detail-card--soft {
  background: rgba(255, 255, 255, 0.86);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.ticket-id {
  font-size: 1.45rem;
  font-weight: 900;
  letter-spacing: 0.02em;
}

.status-pill {
  border-radius: 999px;
  padding: 10px 14px;
  font-weight: 700;
  font-size: 0.88rem;
  white-space: nowrap;
}

.status-pill--0 {
  background: #dbeafe;
  color: #1d4ed8;
}

.status-pill--1 {
  background: #fef3c7;
  color: #a16207;
}

.status-pill--2 {
  background: #dcfce7;
  color: #15803d;
}

.detail-grid,
.price-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-row,
.price-row,
.total-row {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}

.detail-row {
  padding-bottom: 10px;
  border-bottom: 1px solid #e2e8f0;
}

.detail-label {
  min-width: 124px;
  color: #5b6b84;
  font-size: 0.92rem;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.detail-value {
  flex: 1;
  text-align: right;
  color: #10233f;
  word-break: break-word;
}

.detail-value--strong {
  font-weight: 800;
}

.detail-value--danger {
  color: #d92d20;
  font-weight: 700;
}

.detail-link {
  color: #2563eb;
  text-decoration: none;
}

.section-title {
  font-size: 1rem;
  font-weight: 800;
  margin-bottom: 14px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.detail-icon,
.section-icon {
  display: none;
}

.price-row {
  color: #1f2937;
}

.share-media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.share-media-item {
  border-radius: 18px;
  overflow: hidden;
  background: #e2e8f0;
  aspect-ratio: 1;
}

.share-media-button {
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  position: relative;
  cursor: pointer;
}

.share-media-item img,
.share-media-item video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.share-media-badge {
  position: absolute;
  right: 10px;
  bottom: 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.78);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 6px 10px;
}

.media-viewer {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(2, 6, 23, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.media-viewer-inner {
  width: min(100%, 980px);
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-viewer-content {
  max-width: 100%;
  max-height: 82vh;
  border-radius: 22px;
  background: #0f172a;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.35);
}

.media-viewer-close {
  position: absolute;
  top: 18px;
  right: 18px;
  border: 0;
  border-radius: 999px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.media-viewer-download {
  position: absolute;
  right: 18px;
  bottom: 18px;
  border-radius: 999px;
  padding: 10px 16px;
  background: rgba(15, 23, 42, 0.82);
  color: #fff;
  text-decoration: none;
  font-weight: 700;
}

.total-row {
  margin-top: 8px;
  padding-top: 14px;
  border-top: 2px solid #dbe7f5;
  font-size: 1rem;
}

@media (max-width: 640px) {
  .share-view {
    padding: 14px 10px 28px;
  }

  .share-shell {
    gap: 14px;
  }

  .hero-card,
  .detail-card {
    padding: 16px;
    border-radius: 20px;
  }

  .hero-logo {
    width: 46px;
    height: 46px;
    border-radius: 14px;
    font-size: 1.08rem;
  }

  .hero-title {
    font-size: 1.08rem;
    line-height: 1.15;
  }

  .hero-note,
  .updated-at {
    font-size: 0.84rem;
  }

  .hero-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .hero-back {
    padding: 9px 14px;
    font-size: 0.84rem;
  }

  .ticket-id {
    font-size: 1.18rem;
  }

  .status-pill {
    padding: 8px 12px;
    font-size: 0.82rem;
  }

  .hero-card,
  .detail-header,
  .detail-row,
  .price-row,
  .total-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .detail-value {
    text-align: left;
  }

  .detail-row,
  .price-row,
  .total-row {
    border-bottom: none;
    padding: 12px 14px;
    background: #f8fbff;
    border-radius: 16px;
    gap: 8px;
  }

  .detail-grid,
  .price-list {
    gap: 10px;
  }

  .detail-label {
    min-width: 0;
    font-size: 0.83rem;
    letter-spacing: 0.01em;
  }

  .detail-value {
    font-size: 0.96rem;
    line-height: 1.5;
  }

  .detail-icon,
  .section-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 10px;
    background: linear-gradient(135deg, #e0ecff, #e8f7ef);
    color: #2557a7;
    font-size: 0.66rem;
    font-weight: 800;
    flex-shrink: 0;
  }

  .section-icon {
    width: 30px;
    height: 30px;
    border-radius: 11px;
    font-size: 0.7rem;
  }

  .section-icon--small {
    width: 24px;
    height: 24px;
    border-radius: 9px;
    margin-right: 6px;
  }

  .section-title {
    margin-bottom: 12px;
  }

  .share-media-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .share-media-item {
    border-radius: 16px;
  }

  .share-media-badge {
    right: 8px;
    bottom: 8px;
    font-size: 0.68rem;
    padding: 5px 8px;
  }

  .media-viewer {
    padding: 12px;
  }

  .media-viewer-content {
    max-height: 76vh;
    border-radius: 16px;
  }

  .media-viewer-close {
    top: 10px;
    right: 10px;
    padding: 8px 12px;
    font-size: 0.84rem;
  }

  .media-viewer-download {
    right: 10px;
    bottom: 10px;
    padding: 8px 12px;
    font-size: 0.84rem;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
