<script setup>
import { computed, onMounted, ref } from 'vue'
import { getPublicShareSupabase } from '@/lib/publicShareSupabase'

const supabase = getPublicShareSupabase()

const loading = ref(true)
const error = ref('')
const sharePayload = ref(null)
const shareUpdatedAt = ref('')

const customer = computed(() => sharePayload.value || null)

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
  0: 'Dang lam',
  1: 'Cho linh kien',
  2: 'Hoan thanh',
}

const formatDateTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
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

const loadPublicShare = async () => {
  loading.value = true
  error.value = ''

  try {
    const params = new URLSearchParams(location.search)
    const token = params.get('token')?.trim()

    if (!token || token.length < 24) {
      throw new Error('Link xem khong hop le hoac da het han.')
    }

    const { data, error: rpcError } = await supabase.rpc('get_public_customer_share', {
      p_token: token,
    })

    if (rpcError) throw rpcError

    const row = Array.isArray(data) ? data[0] : data
    const payload = row?.public_payload

    if (!payload || typeof payload !== 'object') {
      throw new Error('Khong tim thay du lieu chia se cho ca nay.')
    }

    sharePayload.value = payload
    shareUpdatedAt.value = row?.updated_at || ''
  } catch (err) {
    console.error('[SharePage]', err)
    error.value = err?.message || 'Khong mo duoc link xem nay.'
  } finally {
    loading.value = false
  }
}

onMounted(loadPublicShare)
</script>

<template>
  <div class="share-view">
    <div class="share-shell">
      <div class="hero-card">
        <div class="hero-brand">
          <div class="hero-logo">TV</div>
          <div>
            <div class="hero-title">Thong tin ca sua chua</div>
          </div>
        </div>
        <div class="hero-note">Khong co quyen sua doi du lieu</div>
      </div>

      <div v-if="loading" class="state-card">
        <div class="loader-ring" aria-hidden="true"></div>
        <p>Dang tai thong tin ca...</p>
      </div>

      <div v-else-if="error" class="state-card state-card--error">
        <p>{{ error }}</p>
      </div>

      <div v-else-if="customer" class="content-stack">
        <section class="detail-card">
          <div class="detail-header">
            <div>
              <div class="ticket-id">{{ customer.ticketId || 'Khong ro ma ca' }}</div>
              <div class="updated-at" v-if="shareUpdatedAt">Cap nhat: {{ formatDateTime(shareUpdatedAt) }}</div>
            </div>
            <div :class="['status-pill', `status-pill--${customer.status ?? 0}`]">
              {{ STATUS_LABEL[customer.status ?? 0] || 'Dang cap nhat' }}
            </div>
          </div>

          <div class="detail-grid">
            <div class="detail-row">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.customer }}</span>Khach hang</span>
              <span class="detail-value detail-value--strong">{{ customer.name || 'Dang cap nhat' }}</span>
            </div>
            <div class="detail-row" v-if="customer.phone">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.phone }}</span>So dien thoai</span>
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
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.issue }}</span>Tinh trang</span>
              <span class="detail-value detail-value--danger">{{ customer.issue || 'Dang cap nhat' }}</span>
            </div>
            <div class="detail-row" v-if="customer.replacedPart">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.part }}</span>Linh kien</span>
              <span class="detail-value">{{ customer.replacedPart }}</span>
            </div>
            <div class="detail-row" v-if="customer.address">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.address }}</span>Dia chi</span>
              <span class="detail-value">{{ customer.address }}</span>
            </div>
            <div class="detail-row" v-if="customer.createdAt">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.created }}</span>Ngay tao</span>
              <span class="detail-value">{{ formatDateTime(customer.createdAt) }}</span>
            </div>
            <div class="detail-row" v-if="customer.doneDate">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.done }}</span>Ngay hoan thanh</span>
              <span class="detail-value">{{ customer.doneDate }}</span>
            </div>
          </div>
        </section>

        <section v-if="customer.lkItems?.length || customer.price" class="detail-card detail-card--soft">
          <div class="section-title"><span class="section-icon">{{ DETAIL_ICONS.price }}</span>Phi sua chua</div>
          <div v-if="customer.lkItems?.length" class="price-list">
            <div v-for="(item, index) in customer.lkItems" :key="`${item.name}-${index}`" class="price-row">
              <span>{{ item.name }}</span>
              <strong>{{ formatPrice(item.price) }}</strong>
            </div>
          </div>
          <div class="total-row">
            <span><span class="section-icon section-icon--small">{{ DETAIL_ICONS.total }}</span>Tong phi</span>
            <strong>{{ formatPrice(customer.price) }}</strong>
          </div>
        </section>

        <section v-if="customer.warranty_label || customer.warranty_expires_at" class="detail-card detail-card--soft">
          <div class="section-title"><span class="section-icon">{{ DETAIL_ICONS.package }}</span>Bao hanh</div>
          <div class="detail-grid">
            <div class="detail-row" v-if="customer.warranty_label">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.package }}</span>Goi</span>
              <span class="detail-value">{{ customer.warranty_label }}</span>
            </div>
            <div class="detail-row" v-if="customer.warranty_start_at">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.start }}</span>Bat dau</span>
              <span class="detail-value">{{ formatDateTime(customer.warranty_start_at) }}</span>
            </div>
            <div class="detail-row" v-if="customer.warranty_expires_at">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.expires }}</span>Het han</span>
              <span class="detail-value">{{ formatDateTime(customer.warranty_expires_at) }}</span>
            </div>
            <div class="detail-row" v-if="customer.warranty_remaining_text">
              <span class="detail-label"><span class="detail-icon">{{ DETAIL_ICONS.state }}</span>Trang thai</span>
              <span class="detail-value">{{ customer.warranty_remaining_text }}</span>
            </div>
          </div>
        </section>
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

.total-row {
  margin-top: 8px;
  padding-top: 14px;
  border-top: 2px solid #dbe7f5;
  font-size: 1rem;
}

@media (max-width: 640px) {
  .hero-card,
  .detail-card {
    padding: 18px;
    border-radius: 20px;
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
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
