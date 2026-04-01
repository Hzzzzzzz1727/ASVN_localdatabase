<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'

const {
  getAllProfiles,
  createNhanVien,
  reviewRegistration,
  toggleUserActive,
  deleteUser,
  updateProfile,
  currentProfile,
} = useAuth()

const profiles = ref([])
const isLoading = ref(false)
const showForm = ref(false)
const editingId = ref(null)
const newUser = ref({ email: '', password: '', fullName: '', warehouse: '', phone: '' })
const formError = ref('')
const formLoading = ref(false)

const showApprovalModal = ref(false)
const approvalLoading = ref(false)
const approvalNote = ref('')
const pendingIndex = ref(0)

const toasts = ref([])
let tid = 0
const toast = (msg, type = 'success') => {
  const id = ++tid
  toasts.value.push({ id, msg, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 3000)
}

const pendingProfiles = computed(() => profiles.value.filter((profile) => profile.account_status === 'pending'))
const currentPendingProfile = computed(() => pendingProfiles.value[pendingIndex.value] || null)

watch(pendingProfiles, (items) => {
  if (!items.length) {
    showApprovalModal.value = false
    pendingIndex.value = 0
    approvalNote.value = ''
    return
  }

  if (pendingIndex.value >= items.length) {
    pendingIndex.value = 0
  }

  if (!showApprovalModal.value) {
    showApprovalModal.value = true
    approvalNote.value = ''
  }
})

const load = async () => {
  isLoading.value = true
  try {
    profiles.value = await getAllProfiles()
  } catch (error) {
    toast(`Lỗi tải danh sách: ${error.message}`, 'error')
  } finally {
    isLoading.value = false
  }
}

const handleCreate = async () => {
  const { email, password, fullName } = newUser.value
  if (!email || !password || !fullName) {
    formError.value = 'Vui lòng nhập đủ thông tin!'
    return
  }
  if (password.length < 6) {
    formError.value = 'Mật khẩu tối thiểu 6 ký tự!'
    return
  }

  formLoading.value = true
  formError.value = ''
  try {
    await createNhanVien({
      email,
      password,
      fullName,
      phone: newUser.value.phone || null,
      warehouse: newUser.value.warehouse || null,
    })
    toast(`Đã tạo tài khoản: ${fullName}`)
    newUser.value = { email: '', password: '', fullName: '', warehouse: '', phone: '' }
    showForm.value = false
    await load()
  } catch (error) {
    formError.value = error.message
  } finally {
    formLoading.value = false
  }
}

const handleReviewRegistration = async (approved) => {
  if (!currentPendingProfile.value) return

  approvalLoading.value = true
  try {
    const updatedProfile = await reviewRegistration({
      id: currentPendingProfile.value.id,
      approved,
      note: approvalNote.value.trim(),
    })

    const index = profiles.value.findIndex((profile) => profile.id === updatedProfile.id)
    if (index !== -1) profiles.value[index] = updatedProfile

    toast(
      approved
        ? `Đã xác nhận tài khoản ${updatedProfile.full_name || updatedProfile.email}`
        : `Đã từ chối tài khoản ${updatedProfile.full_name || updatedProfile.email}`,
      approved ? 'success' : 'error',
    )

    approvalNote.value = ''
    if (pendingProfiles.value.length > 1) {
      pendingIndex.value = Math.min(pendingIndex.value, pendingProfiles.value.length - 2)
    }
  } catch (error) {
    toast(`Lỗi xử lý đăng ký: ${error.message}`, 'error')
  } finally {
    approvalLoading.value = false
  }
}

const handleToggle = async (profile) => {
  if (profile.id === currentProfile.value?.id) {
    toast('Không thể khóa tài khoản đang dùng!', 'error')
    return
  }
  try {
    await toggleUserActive(profile.id, !profile.is_active)
    profile.is_active = !profile.is_active
    toast(profile.is_active ? 'Đã mở tài khoản' : 'Đã khóa tài khoản')
  } catch (error) {
    toast(`Lỗi: ${error.message}`, 'error')
  }
}

const handleSaveWarehouse = async (profile) => {
  try {
    await updateProfile(profile.id, { warehouse: profile.warehouse || null })
    toast('Đã cập nhật kho!')
    editingId.value = null
  } catch (error) {
    toast(`Lỗi: ${error.message}`, 'error')
  }
}

const handleDelete = async (profile) => {
  if (profile.id === currentProfile.value?.id) {
    toast('Không thể xóa tài khoản đang dùng!', 'error')
    return
  }
  if (!confirm(`Xóa tài khoản "${profile.full_name}" (${profile.email})?`)) return
  try {
    await deleteUser(profile.id)
    toast('Đã xóa!')
    await load()
  } catch (error) {
    toast(`Lỗi xóa: ${error.message}`, 'error')
  }
}

const whLabel = (warehouse) => (
  warehouse === 'TDP'
    ? 'Kho TDP'
    : warehouse === 'NV'
      ? 'Kho NV'
      : 'Cả 2 kho'
)

const statusLabel = (profile) => {
  if (profile.account_status === 'pending') return 'Chờ duyệt'
  if (profile.account_status === 'rejected') return 'Từ chối'
  if (!profile.is_active) return 'Bị khóa'
  return 'Đã duyệt'
}

const statusClass = (profile) => {
  if (profile.account_status === 'pending') return 'chip-pending'
  if (profile.account_status === 'rejected') return 'chip-rejected'
  if (!profile.is_active) return 'chip-locked'
  return 'chip-approved'
}

onMounted(load)
</script>

<template>
  <div class="ap">
    <div class="toast-stack">
      <div v-for="t in toasts" :key="t.id" :class="['t-item', `t-${t.type}`]">{{ t.msg }}</div>
    </div>

    <div class="ap-header">
      <div>
        <h3 class="ap-title">Quản lý tài khoản</h3>
        <p class="ap-sub">Duyệt đăng ký mới, phân kho và khóa/mở tài khoản tại đây.</p>
      </div>
      <div class="ap-header-actions">
        <button v-if="pendingProfiles.length" class="btn-pending" @click="showApprovalModal = true">
          Chờ duyệt ({{ pendingProfiles.length }})
        </button>
        <button class="btn-new" @click="showForm = true; formError = ''">+ Tạo tài khoản</button>
      </div>
    </div>

    <div v-if="isLoading" class="ap-loading">
      <div class="spinner-border text-primary"></div>
    </div>

    <div v-else class="ap-list">
      <div v-for="p in profiles" :key="p.id" :class="['ap-card', { 'ap-card--inactive': !p.is_active && p.account_status !== 'pending' }]">
        <div class="ap-info">
          <div class="ap-avatar">{{ (p.full_name?.[0] || p.email?.[0] || '?').toUpperCase() }}</div>
          <div class="ap-detail">
            <div class="ap-name">
              {{ p.full_name || '(chưa đặt tên)' }}
              <span v-if="p.id === currentProfile?.id" class="chip chip-me">Bạn</span>
              <span :class="['chip', statusClass(p)]">{{ statusLabel(p) }}</span>
            </div>
            <div class="ap-email">{{ p.email }}</div>
            <div v-if="p.phone" class="ap-phone">{{ p.phone }}</div>
            <div class="ap-meta">
              <span :class="['chip', p.role === 'admin' ? 'chip-admin' : 'chip-nv']">
                {{ p.role === 'admin' ? 'Admin' : 'Nhân viên' }}
              </span>
              <template v-if="p.role === 'nhanvien'">
                <span v-if="editingId !== p.id" class="chip chip-wh" @click="editingId = p.id">
                  {{ whLabel(p.warehouse) }} ✏️
                </span>
                <span v-else class="wh-edit">
                  <select v-model="p.warehouse" class="wh-sel">
                    <option value="">Cả 2 kho</option>
                    <option value="TDP">Kho TDP</option>
                    <option value="NV">Kho NV</option>
                  </select>
                  <button class="btn-ok" @click="handleSaveWarehouse(p)">✓</button>
                  <button class="btn-cx" @click="editingId = null">✕</button>
                </span>
              </template>
            </div>
            <div v-if="p.account_status === 'rejected' && p.approval_note" class="ap-note rejected-note">
              {{ p.approval_note }}
            </div>
            <div v-if="p.account_status === 'pending'" class="ap-note pending-note">
              Đăng ký mới đang chờ admin xác nhận.
            </div>
          </div>
        </div>

        <div class="ap-actions">
          <button
            v-if="p.account_status === 'pending'"
            class="btn-approve"
            @click="showApprovalModal = true; pendingIndex = Math.max(0, pendingProfiles.findIndex((item) => item.id === p.id)); approvalNote = p.approval_note || ''"
          >
            Duyệt
          </button>
          <button
            v-if="p.id !== currentProfile?.id && p.account_status === 'approved'"
            :class="['btn-toggle', p.is_active ? 'btn-toggle--lock' : 'btn-toggle--unlock']"
            @click="handleToggle(p)"
          >
            {{ p.is_active ? 'Khóa' : 'Mở' }}
          </button>
          <button v-if="p.role !== 'admin'" class="btn-del" @click="handleDelete(p)" title="Xóa">🗑️</button>
        </div>
      </div>

      <div v-if="profiles.length === 0" class="ap-empty">Chưa có tài khoản nào</div>
    </div>

    <div v-if="showForm" class="modal-ov" @click.self="showForm = false">
      <div class="modal-box">
        <div class="modal-hd">
          <h5>Tạo tài khoản nhân viên</h5>
          <button class="modal-x" @click="showForm = false">✕</button>
        </div>
        <div class="modal-bd">
          <div class="fg">
            <label>Họ tên <span class="req">*</span></label>
            <input v-model="newUser.fullName" type="text" class="fi" placeholder="VD: Nguyễn Văn A">
          </div>
          <div class="fg">
            <label>Số điện thoại</label>
            <input v-model="newUser.phone" type="tel" class="fi" placeholder="090xxxxxxx">
          </div>
          <div class="fg">
            <label>Email <span class="req">*</span></label>
            <input v-model="newUser.email" type="email" class="fi" placeholder="nhanvien@email.com">
          </div>
          <div class="fg">
            <label>Mật khẩu <span class="req">*</span></label>
            <input v-model="newUser.password" type="password" class="fi" placeholder="Tối thiểu 6 ký tự">
          </div>
          <div class="fg">
            <label>Phân kho mặc định</label>
            <select v-model="newUser.warehouse" class="fi">
              <option value="">Xem cả 2 kho</option>
              <option value="TDP">Kho TDP</option>
              <option value="NV">Kho NV</option>
            </select>
          </div>
          <div v-if="formError" class="form-err">⚠️ {{ formError }}</div>
        </div>
        <div class="modal-ft">
          <button class="btn-sec" @click="showForm = false">Hủy</button>
          <button class="btn-pri" :disabled="formLoading" @click="handleCreate">
            <span v-if="formLoading" class="spin-sm"></span>
            {{ formLoading ? 'Đang tạo...' : 'Tạo tài khoản' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showApprovalModal && currentPendingProfile" class="modal-ov" @click.self="showApprovalModal = false">
      <div class="modal-box modal-box--approval">
        <div class="modal-hd">
          <h5>Xác nhận tài khoản đăng ký mới</h5>
          <button class="modal-x" @click="showApprovalModal = false">✕</button>
        </div>
        <div class="modal-bd">
          <div class="approval-badge">Chờ duyệt {{ pendingIndex + 1 }}/{{ pendingProfiles.length }}</div>
          <div class="approval-grid">
            <div><strong>Họ tên:</strong> {{ currentPendingProfile.full_name }}</div>
            <div><strong>SĐT:</strong> {{ currentPendingProfile.phone || 'Chưa có' }}</div>
            <div><strong>Email:</strong> {{ currentPendingProfile.email }}</div>
            <div><strong>Đăng ký lúc:</strong> {{ currentPendingProfile.created_at ? new Date(currentPendingProfile.created_at).toLocaleString('vi-VN') : 'Không rõ' }}</div>
          </div>

          <div class="fg">
            <label>Ghi chú cho người đăng ký</label>
            <textarea v-model="approvalNote" class="fi fi-textarea" :placeholder="'Ví dụ: Vui lòng liên hệ lại admin hoặc tài khoản của bạn đã bị từ chối.'"></textarea>
          </div>
        </div>
        <div class="modal-ft modal-ft--approval">
          <button class="btn-sec" :disabled="approvalLoading" @click="showApprovalModal = false">Để sau</button>
          <button class="btn-reject" :disabled="approvalLoading" @click="handleReviewRegistration(false)">
            {{ approvalLoading ? 'Đang xử lý...' : 'Từ chối' }}
          </button>
          <button class="btn-pri" :disabled="approvalLoading" @click="handleReviewRegistration(true)">
            {{ approvalLoading ? 'Đang xử lý...' : 'Xác nhận cho vào hệ thống' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@media (max-width: 480px) {
  .ap-card { flex-wrap: wrap; padding: 0.75rem; }
  .ap-info { flex: 1 1 100%; }
  .ap-actions { flex: 1 1 100%; justify-content: flex-end; margin-top: 0.4rem; border-top: 1px solid #e2e8f0; padding-top: 0.4rem; }
  .ap-email, .ap-phone { max-width: 220px; }
  .ap-avatar { width: 34px; height: 34px; font-size: 0.9rem; }
  .ap-name { font-size: 0.88rem; }
  .btn-toggle, .btn-approve { font-size: 0.75rem; padding: 0.3rem 0.55rem; }
  .ap-title { font-size: 0.95rem; }
  .btn-new, .btn-pending { font-size: 0.8rem; padding: 0.45rem 0.8rem; }
  .ap-header { flex-direction: column; align-items: flex-start; gap: 0.8rem; }
  .ap-header-actions { width: 100%; justify-content: space-between; }
}

.toast-stack { position: fixed; top: 5rem; right: 1rem; z-index: 9999; display: flex; flex-direction: column; gap: 0.4rem; }
.t-item { padding: 0.65rem 1rem; border-radius: 10px; font-weight: 600; font-size: 0.88rem; color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.15); animation: tin .3s ease; }
.t-success { background: #10b981; }
.t-error { background: #ef4444; }
@keyframes tin { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: none; } }

.ap { padding: 0; }
.ap-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.1rem; gap: 1rem; }
.ap-header-actions { display: flex; gap: 0.6rem; align-items: center; }
.ap-title { font-weight: 700; font-size: 1.05rem; color: #1e293b; margin: 0; }
.ap-sub { margin: 0.2rem 0 0; color: #64748b; font-size: 0.84rem; }
.btn-new, .btn-pending { color: #fff; border: none; border-radius: 10px; padding: 0.55rem 1rem; font-weight: 600; font-size: 0.88rem; cursor: pointer; transition: all .2s; }
.btn-new { background: #3b82f6; }
.btn-pending { background: #f59e0b; }
.btn-new:hover { background: #2563eb; transform: translateY(-1px); }
.btn-pending:hover { background: #d97706; transform: translateY(-1px); }
.ap-loading { text-align: center; padding: 2rem; }
.ap-list { display: flex; flex-direction: column; gap: 0.65rem; }
.ap-empty { text-align: center; color: #94a3b8; padding: 2rem; }

.ap-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 0.9rem 1.1rem;
  gap: 0.75rem;
  transition: border-color .2s;
}
.ap-card:hover { border-color: #93c5fd; }
.ap-card--inactive { opacity: 0.6; background: #fff7ed; border-color: #fed7aa; }

.ap-info { display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 0; }
.ap-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.05rem;
}
.ap-detail { min-width: 0; }
.ap-name { font-weight: 700; color: #1e293b; font-size: 0.93rem; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.ap-email, .ap-phone { color: #64748b; font-size: 0.8rem; margin: 0.1rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ap-meta { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.25rem; }
.ap-note { margin-top: 0.45rem; font-size: 0.8rem; font-weight: 600; }
.pending-note { color: #92400e; }
.rejected-note { color: #991b1b; }

.chip { padding: 0.18rem 0.55rem; border-radius: 7px; font-size: 0.75rem; font-weight: 600; }
.chip-admin { background: #fef3c7; color: #92400e; }
.chip-nv { background: #dbeafe; color: #1d4ed8; }
.chip-me { background: #d1fae5; color: #065f46; }
.chip-approved { background: #dcfce7; color: #166534; }
.chip-pending { background: #fef3c7; color: #92400e; }
.chip-rejected, .chip-locked { background: #fee2e2; color: #991b1b; }
.chip-wh { background: #f0fdf4; color: #166534; border: 1px dashed #86efac; cursor: pointer; }
.chip-wh:hover { background: #dcfce7; }

.wh-edit { display: flex; align-items: center; gap: 0.25rem; }
.wh-sel { font-size: 0.78rem; padding: 0.2rem 0.35rem; border-radius: 6px; border: 1px solid #d1d5db; }
.btn-ok, .btn-cx { color: #fff; border: none; border-radius: 5px; padding: 0.2rem 0.45rem; cursor: pointer; font-size: 0.82rem; }
.btn-ok { background: #10b981; }
.btn-cx { background: #6b7280; }

.ap-actions { display: flex; gap: 0.4rem; align-items: center; flex-shrink: 0; }
.btn-toggle, .btn-approve, .btn-reject {
  border: none;
  border-radius: 8px;
  padding: 0.38rem 0.7rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all .2s;
}
.btn-toggle--lock { background: #fee2e2; color: #991b1b; }
.btn-toggle--unlock { background: #d1fae5; color: #065f46; }
.btn-approve { background: #dbeafe; color: #1d4ed8; }
.btn-reject { background: #fee2e2; color: #991b1b; }
.btn-del { background: none; border: none; font-size: 1.05rem; cursor: pointer; opacity: 0.45; padding: 0.2rem; transition: opacity .2s; }
.btn-del:hover { opacity: 1; }

.modal-ov { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 1rem; }
.modal-box { background: #fff; border-radius: 20px; width: 100%; max-width: 460px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
.modal-box--approval { max-width: 560px; }
.modal-hd { display: flex; justify-content: space-between; align-items: center; padding: 1.1rem 1.4rem; border-bottom: 1px solid #e2e8f0; }
.modal-hd h5 { margin: 0; font-weight: 700; font-size: 0.98rem; }
.modal-x { background: none; border: none; font-size: 1.05rem; cursor: pointer; color: #64748b; }
.modal-bd { padding: 1.3rem 1.4rem; }
.modal-ft { padding: 0.9rem 1.4rem; border-top: 1px solid #e2e8f0; display: flex; gap: 0.65rem; justify-content: flex-end; }
.modal-ft--approval { flex-wrap: wrap; }

.fg { margin-bottom: 0.95rem; }
.fg label { display: block; font-weight: 600; font-size: 0.85rem; color: #374151; margin-bottom: 0.35rem; }
.fi {
  width: 100%;
  padding: 0.65rem 0.9rem;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.92rem;
  outline: none;
  transition: border-color .2s;
  box-sizing: border-box;
}
.fi:focus { border-color: #3b82f6; }
.fi-textarea { min-height: 110px; resize: vertical; }
.req { color: #ef4444; }
.form-err { background: #fee2e2; border: 1px solid #fca5a5; color: #991b1b; padding: 0.6rem 0.85rem; border-radius: 8px; font-size: 0.85rem; margin-top: 0.5rem; }

.approval-badge {
  display: inline-flex;
  margin-bottom: 0.9rem;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-weight: 700;
  font-size: 0.8rem;
}
.approval-grid {
  display: grid;
  gap: 0.55rem;
  margin-bottom: 1rem;
  color: #334155;
  font-size: 0.92rem;
}

.btn-pri, .btn-sec {
  border-radius: 10px;
  padding: 0.6rem 1.2rem;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.9rem;
}
.btn-pri {
  background: #3b82f6;
  color: #fff;
  border: none;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.btn-pri:disabled { opacity: .7; cursor: not-allowed; }
.btn-sec {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
}
.spin-sm {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255,255,255,.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .7s linear infinite;
  display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
