<script setup>
import { computed, onMounted, ref } from 'vue'
import { getSupabase } from '@/lib/supabase'
import {
  buildPublicShareUrl,
  copyText,
  disableShareRecord,
  ensureShareRecord,
  loadShareRecordByCustomerId,
} from '@/lib/shareLinks'

const supabase = getSupabase()

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const isAdminUser = ref(false)
const customer = ref(null)
const shareRecord = ref(null)
const customerId = ref(null)

const publicUrl = computed(() => shareRecord.value?.publicUrl || '')

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

const ensureAdmin = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) throw new Error('Can dang nhap admin de quan ly link xem.')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, full_name, is_active')
    .eq('id', userId)
    .single()

  if (profileError) throw profileError
  if (!profile?.is_active || profile?.role !== 'admin') {
    throw new Error('Trang nay chi danh cho admin.')
  }

  isAdminUser.value = true
  return session.user
}

const loadCustomer = async (id) => {
  const { data, error: loadError } = await supabase
    .from('customers')
    .select('id, ticketId, name, phone, model, issue, status, doneDate, createdAt')
    .eq('id', id)
    .maybeSingle()

  if (loadError) throw loadError
  if (!data) throw new Error('Khong tim thay ca can tao link.')
  customer.value = data
}

const boot = async () => {
  loading.value = true
  error.value = ''

  try {
    const params = new URLSearchParams(location.search)
    const rawId = params.get('id')
    const parsedId = Number(rawId)
    if (!rawId || !Number.isFinite(parsedId)) {
      throw new Error('Thieu ma ca de quan ly link.')
    }

    customerId.value = parsedId
    const sessionUser = await ensureAdmin()
    await loadCustomer(parsedId)
    shareRecord.value = await loadShareRecordByCustomerId(supabase, parsedId)

    if (!shareRecord.value) {
      shareRecord.value = await ensureShareRecord(supabase, parsedId, sessionUser.id, false)
    }
  } catch (err) {
    console.error('[ShareAdminPage]', err)
    error.value = err?.message || 'Khong mo duoc trang quan ly link.'
  } finally {
    loading.value = false
  }
}

const withSaving = async (task) => {
  saving.value = true
  error.value = ''
  try {
    await task()
  } catch (err) {
    console.error('[ShareAdminPage]', err)
    error.value = err?.message || 'Khong xu ly duoc yeu cau nay.'
  } finally {
    saving.value = false
  }
}

const handleCopy = async () => {
  await withSaving(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    shareRecord.value = await ensureShareRecord(supabase, customerId.value, session?.user?.id, false)
    await copyText(shareRecord.value.publicUrl)
  })
}

const handleRotate = async () => {
  await withSaving(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    shareRecord.value = await ensureShareRecord(supabase, customerId.value, session?.user?.id, true)
  })
}

const handleDisable = async () => {
  await withSaving(async () => {
    shareRecord.value = await disableShareRecord(supabase, customerId.value)
  })
}

const handleEnable = async () => {
  await withSaving(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    shareRecord.value = await ensureShareRecord(supabase, customerId.value, session?.user?.id, false)
  })
}

const openPublicPage = () => {
  if (!publicUrl.value) return
  window.open(buildPublicShareUrl(shareRecord.value.share_token), '_blank', 'noopener')
}

onMounted(boot)
</script>

<template>
  <div class="admin-share-page">
    <div class="admin-shell">
      <div class="admin-hero">
        <div>
          <div class="eyebrow">Admin only</div>
          <h1>Quan ly link xem cho khach</h1>
          <p>Trang nay chi tao va quan ly duong link doc thong tin cua mot ca duy nhat.</p>
        </div>
        <div v-if="customer" class="ticket-chip">{{ customer.ticketId }}</div>
      </div>

      <div v-if="loading" class="panel panel--center">
        <div class="loader-ring" aria-hidden="true"></div>
        <p>Dang tai trang quan ly link...</p>
      </div>

      <div v-else-if="error && !isAdminUser" class="panel panel--error">
        <p>{{ error }}</p>
      </div>

      <template v-else>
        <div v-if="error" class="panel panel--error">
          <p>{{ error }}</p>
        </div>

        <section v-if="customer" class="panel">
          <div class="panel-title">Thong tin ca</div>
          <div class="info-grid">
            <div class="info-row">
              <span>Khach hang</span>
              <strong>{{ customer.name || 'Dang cap nhat' }}</strong>
            </div>
            <div class="info-row">
              <span>So dien thoai</span>
              <strong>{{ customer.phone || 'Chua co' }}</strong>
            </div>
            <div class="info-row">
              <span>Model</span>
              <strong>{{ customer.model || 'Chua co' }}</strong>
            </div>
            <div class="info-row">
              <span>Tinh trang</span>
              <strong>{{ customer.issue || 'Dang cap nhat' }}</strong>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-title">Link hien tai</div>
          <div class="status-row">
            <span :class="['status-tag', shareRecord?.share_enabled === false ? 'status-tag--off' : 'status-tag--on']">
              {{ shareRecord?.share_enabled === false ? 'Da tat' : 'Dang hoat dong' }}
            </span>
            <span class="status-meta" v-if="shareRecord?.updated_at">Cap nhat: {{ formatDateTime(shareRecord.updated_at) }}</span>
          </div>

          <textarea
            class="link-box"
            readonly
            :value="publicUrl || 'Link chua duoc tao'"
          ></textarea>

          <div class="action-row">
            <button class="btn-primary-action" :disabled="saving" @click="handleCopy">
              {{ saving ? 'Dang xu ly...' : 'Copy link xem' }}
            </button>
            <button class="btn-secondary-action" :disabled="saving || !publicUrl" @click="openPublicPage">Mo trang xem</button>
            <button class="btn-secondary-action" :disabled="saving" @click="handleRotate">Doi link moi</button>
            <button
              v-if="shareRecord?.share_enabled !== false"
              class="btn-danger-action"
              :disabled="saving"
              @click="handleDisable"
            >
              Tat link
            </button>
            <button
              v-else
              class="btn-secondary-action"
              :disabled="saving"
              @click="handleEnable"
            >
              Bat lai link
            </button>
          </div>

          <div class="hint-list">
            <p>Link chi mo duoc trang chi doc theo token.</p>
            <p>Khach khong co nut sua, khong doc bang customers truc tiep neu policy SQL da duoc ap dung.</p>
            <p>Khi admin cap nhat thong tin ca, snapshot public se theo trigger DB de cap nhat lai.</p>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
:global(body) {
  margin: 0;
  background: linear-gradient(180deg, #eef7ff 0%, #f8fafc 100%);
  color: #0f172a;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
}

* {
  box-sizing: border-box;
}

.admin-share-page {
  min-height: 100vh;
  padding: 28px 16px 48px;
}

.admin-shell {
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.admin-hero,
.panel {
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 24px;
  box-shadow: 0 16px 42px rgba(15, 23, 42, 0.08);
}

.admin-hero {
  padding: 22px 24px;
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}

.eyebrow {
  color: #2563eb;
  font-weight: 800;
  text-transform: uppercase;
  font-size: 0.74rem;
  letter-spacing: 0.12em;
}

h1 {
  margin: 8px 0 10px;
  font-size: 1.6rem;
}

.admin-hero p {
  margin: 0;
  color: #475569;
  max-width: 620px;
}

.ticket-chip {
  border-radius: 999px;
  background: #0f172a;
  color: #fff;
  padding: 10px 14px;
  font-weight: 800;
  white-space: nowrap;
}

.panel {
  padding: 22px 24px;
}

.panel--center,
.panel--error {
  text-align: center;
}

.panel--error {
  color: #b42318;
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

.panel-title {
  font-size: 1.05rem;
  font-weight: 800;
  margin-bottom: 14px;
}

.info-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.info-row,
.status-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.info-row span,
.status-meta {
  color: #64748b;
}

.status-row {
  margin-bottom: 14px;
}

.status-tag {
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 0.85rem;
  font-weight: 800;
}

.status-tag--on {
  background: #dcfce7;
  color: #15803d;
}

.status-tag--off {
  background: #fee2e2;
  color: #b91c1c;
}

.link-box {
  width: 100%;
  min-height: 116px;
  border-radius: 16px;
  border: 1px solid #cbd5e1;
  padding: 14px;
  resize: vertical;
  font-size: 0.95rem;
  color: #0f172a;
  background: #f8fafc;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.btn-primary-action,
.btn-secondary-action,
.btn-danger-action {
  border: none;
  border-radius: 12px;
  padding: 11px 15px;
  font-weight: 800;
  cursor: pointer;
}

.btn-primary-action {
  background: #2563eb;
  color: #fff;
}

.btn-secondary-action {
  background: #e2e8f0;
  color: #0f172a;
}

.btn-danger-action {
  background: #dc2626;
  color: #fff;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hint-list {
  margin-top: 16px;
  color: #475569;
  font-size: 0.92rem;
}

.hint-list p {
  margin: 0 0 8px;
}

@media (max-width: 640px) {
  .admin-hero,
  .info-row,
  .status-row {
    flex-direction: column;
  }

  .panel,
  .admin-hero {
    padding: 18px;
    border-radius: 20px;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
