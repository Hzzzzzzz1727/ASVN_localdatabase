<script setup>
import { computed, ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { getSupabase } from '@/lib/supabase'

const supabase = getSupabase()
const { currentProfile, updateProfile, changePassword } = useAuth()

const profileForm = ref({
  full_name: '',
  phone: '',
  avatar_url: '',
})

const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const infoMessage = ref('')
const passwordMessage = ref('')
const infoError = ref('')
const passwordError = ref('')
const profileLoading = ref(false)
const passwordLoading = ref(false)
const pendingAvatarFile = ref(null)
const pendingAvatarPreview = ref('')
const removeAvatar = ref(false)

watch(currentProfile, (profile) => {
  profileForm.value = {
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
    avatar_url: profile?.avatar_url || '',
  }
  pendingAvatarFile.value = null
  pendingAvatarPreview.value = ''
  removeAvatar.value = false
}, { immediate: true })

const profileInitial = computed(() => {
  const source = profileForm.value.full_name || currentProfile.value?.email || '?'
  return source.trim().charAt(0).toUpperCase() || '?'
})

const resolvedAvatarUrl = (path) => {
  if (!path) return ''
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl || ''
}

const avatarPreviewUrl = computed(() => {
  if (pendingAvatarPreview.value) return pendingAvatarPreview.value
  if (removeAvatar.value) return ''
  return resolvedAvatarUrl(profileForm.value.avatar_url)
})

const pickAvatar = (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  pendingAvatarFile.value = file
  pendingAvatarPreview.value = URL.createObjectURL(file)
  removeAvatar.value = false
  infoError.value = ''
}

const clearAvatarSelection = () => {
  if (pendingAvatarPreview.value) URL.revokeObjectURL(pendingAvatarPreview.value)
  pendingAvatarPreview.value = ''
  pendingAvatarFile.value = null
}

const markAvatarForRemoval = () => {
  clearAvatarSelection()
  removeAvatar.value = true
}

const uploadAvatarIfNeeded = async () => {
  if (!pendingAvatarFile.value || !currentProfile.value?.id) return profileForm.value.avatar_url || null
  const file = pendingAvatarFile.value
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
  const nextPath = `${currentProfile.value.id}/${Date.now()}-${safeName}`
  const { data, error } = await supabase.storage.from('avatars').upload(nextPath, file)
  if (error) throw new Error(error.message || 'Khong tai len duoc anh dai dien.')
  return data?.path || nextPath
}

const maybeRemoveOldAvatar = async (oldPath, nextPath) => {
  if (!oldPath || oldPath === nextPath) return
  await supabase.storage.from('avatars').remove([oldPath])
}

const saveProfile = async () => {
  if (!currentProfile.value?.id) return
  profileLoading.value = true
  infoMessage.value = ''
  infoError.value = ''

  const oldAvatarPath = currentProfile.value.avatar_url || null
  let uploadedAvatarPath = null

  try {
    uploadedAvatarPath = await uploadAvatarIfNeeded()
    const nextAvatarPath = removeAvatar.value ? null : uploadedAvatarPath
    const updated = await updateProfile(currentProfile.value.id, {
      full_name: profileForm.value.full_name.trim(),
      phone: profileForm.value.phone.trim() || null,
      avatar_url: nextAvatarPath,
    })
    if (removeAvatar.value) {
      await maybeRemoveOldAvatar(oldAvatarPath, null)
    } else if (uploadedAvatarPath) {
      await maybeRemoveOldAvatar(oldAvatarPath, uploadedAvatarPath)
    }
    profileForm.value.avatar_url = updated?.avatar_url || ''
    clearAvatarSelection()
    removeAvatar.value = false
    infoMessage.value = 'Da cap nhat thong tin tai khoan.'
  } catch (error) {
    if (uploadedAvatarPath && uploadedAvatarPath !== oldAvatarPath) {
      await supabase.storage.from('avatars').remove([uploadedAvatarPath])
    }
    infoError.value = error.message || 'Khong cap nhat duoc ho so.'
  } finally {
    profileLoading.value = false
  }
}

const savePassword = async () => {
  passwordMessage.value = ''
  passwordError.value = ''
  if (!passwordForm.value.currentPassword || !passwordForm.value.newPassword || !passwordForm.value.confirmPassword) {
    passwordError.value = 'Vui long nhap day du thong tin mat khau.'
    return
  }
  if (passwordForm.value.newPassword.length < 6) {
    passwordError.value = 'Mat khau moi toi thieu 6 ky tu.'
    return
  }
  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    passwordError.value = 'Xac nhan mat khau chua khop.'
    return
  }

  passwordLoading.value = true
  try {
    await changePassword({
      currentPassword: passwordForm.value.currentPassword,
      newPassword: passwordForm.value.newPassword,
    })
    passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    passwordMessage.value = 'Da doi mat khau thanh cong.'
  } catch (error) {
    passwordError.value = error.message || 'Khong doi duoc mat khau.'
  } finally {
    passwordLoading.value = false
  }
}
</script>

<template>
  <section class="profile-shell">
    <div class="profile-card">
      <div class="profile-hero">
        <div class="avatar-wrap">
          <img v-if="avatarPreviewUrl" :src="avatarPreviewUrl" alt="Avatar" class="avatar-image">
          <div v-else class="avatar-fallback">{{ profileInitial }}</div>
        </div>
        <div class="hero-copy">
          <h2>{{ currentProfile?.full_name || 'Tai khoan ca nhan' }}</h2>
          <p>{{ currentProfile?.email }}</p>
          <div class="hero-chips">
            <span class="hero-chip">{{ currentProfile?.role === 'admin' ? 'Admin' : 'Nhan vien' }}</span>
            <span class="hero-chip hero-chip--soft">{{ currentProfile?.warehouse || 'Ca 2 kho' }}</span>
          </div>
        </div>
      </div>

      <div class="panel-grid">
        <div class="panel-card">
          <div class="panel-head">
            <div>
              <div class="panel-eyebrow">Ho so</div>
              <h3>Thong tin ca nhan</h3>
            </div>
          </div>

          <div class="field">
            <label>Ho ten</label>
            <input v-model="profileForm.full_name" class="field-input" type="text" placeholder="Nhap ho ten">
          </div>

          <div class="field">
            <label>So dien thoai</label>
            <input v-model="profileForm.phone" class="field-input" type="tel" placeholder="090xxxxxxx">
          </div>

          <div class="field">
            <label>Email</label>
            <input :value="currentProfile?.email || ''" class="field-input" type="text" readonly>
          </div>

          <div class="field">
            <label>Anh dai dien</label>
            <div class="avatar-actions">
              <label class="upload-btn">
                Chon anh
                <input type="file" accept="image/*" hidden @change="pickAvatar">
              </label>
              <button v-if="avatarPreviewUrl" class="ghost-btn" type="button" @click="markAvatarForRemoval">Bo anh</button>
            </div>
          </div>

          <div v-if="infoError" class="alert-box alert-box--error">{{ infoError }}</div>
          <div v-else-if="infoMessage" class="alert-box alert-box--success">{{ infoMessage }}</div>

          <div class="panel-actions">
            <button class="primary-btn" type="button" :disabled="profileLoading" @click="saveProfile">
              {{ profileLoading ? 'Dang luu...' : 'Luu thong tin' }}
            </button>
          </div>
        </div>

        <div class="panel-card">
          <div class="panel-head">
            <div>
              <div class="panel-eyebrow">Bao mat</div>
              <h3>Doi mat khau</h3>
            </div>
          </div>

          <div class="field">
            <label>Mat khau hien tai</label>
            <input v-model="passwordForm.currentPassword" class="field-input" type="password" placeholder="Nhap mat khau hien tai">
          </div>
          <div class="field">
            <label>Mat khau moi</label>
            <input v-model="passwordForm.newPassword" class="field-input" type="password" placeholder="Toi thieu 6 ky tu">
          </div>
          <div class="field">
            <label>Xac nhan mat khau moi</label>
            <input v-model="passwordForm.confirmPassword" class="field-input" type="password" placeholder="Nhap lai mat khau moi">
          </div>

          <div v-if="passwordError" class="alert-box alert-box--error">{{ passwordError }}</div>
          <div v-else-if="passwordMessage" class="alert-box alert-box--success">{{ passwordMessage }}</div>

          <div class="panel-actions">
            <button class="primary-btn" type="button" :disabled="passwordLoading" @click="savePassword">
              {{ passwordLoading ? 'Dang doi...' : 'Cap nhat mat khau' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.profile-shell { display: flex; flex-direction: column; gap: 1rem; }
.profile-card { background: linear-gradient(180deg, #ffffff, #f7fbff); border: 1px solid #dbe7f3; border-radius: 28px; padding: 1.4rem; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08); }
.profile-hero { display: flex; align-items: center; gap: 1rem; padding: 0.3rem 0 1.25rem; border-bottom: 1px solid #e2e8f0; }
.avatar-wrap { width: 88px; height: 88px; border-radius: 24px; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg, #0f766e, #0ea5e9); display: flex; align-items: center; justify-content: center; box-shadow: 0 12px 24px rgba(14, 165, 233, 0.2); }
.avatar-image { width: 100%; height: 100%; object-fit: cover; }
.avatar-fallback { color: #fff; font-size: 2rem; font-weight: 800; letter-spacing: -0.04em; }
.hero-copy h2 { margin: 0; font-size: 1.5rem; font-weight: 800; color: #0f172a; }
.hero-copy p { margin: 0.25rem 0 0.65rem; color: #475569; }
.hero-chips { display: flex; flex-wrap: wrap; gap: 0.45rem; }
.hero-chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.35rem 0.75rem; background: #0f172a; color: #fff; font-size: 0.78rem; font-weight: 700; }
.hero-chip--soft { background: #e0f2fe; color: #075985; }
.panel-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 1rem; }
.panel-card { background: rgba(255,255,255,0.82); border: 1px solid #e2e8f0; border-radius: 22px; padding: 1.15rem; }
.panel-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; }
.panel-eyebrow { color: #0891b2; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
.panel-head h3 { margin: 0.2rem 0 0; color: #0f172a; font-size: 1.05rem; font-weight: 800; }
.field { margin-bottom: 0.9rem; }
.field label { display: block; margin-bottom: 0.35rem; color: #334155; font-weight: 700; font-size: 0.84rem; }
.field-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 14px; padding: 0.78rem 0.9rem; background: #fff; color: #0f172a; outline: none; transition: border-color .2s ease, box-shadow .2s ease; }
.field-input:focus { border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.14); }
.avatar-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.upload-btn, .ghost-btn, .primary-btn { border-radius: 999px; font-weight: 700; cursor: pointer; }
.upload-btn { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #93c5fd; background: #eff6ff; color: #1d4ed8; padding: 0.7rem 1rem; }
.ghost-btn { border: 1px solid #fecaca; background: #fff1f2; color: #b91c1c; padding: 0.7rem 1rem; }
.primary-btn { border: none; background: linear-gradient(135deg, #0284c7, #2563eb); color: #fff; padding: 0.8rem 1.1rem; min-width: 170px; box-shadow: 0 14px 24px rgba(37, 99, 235, 0.18); }
.primary-btn:disabled { opacity: 0.75; cursor: not-allowed; box-shadow: none; }
.panel-actions { display: flex; justify-content: flex-end; margin-top: 1rem; }
.alert-box { border-radius: 14px; padding: 0.8rem 0.95rem; font-size: 0.84rem; font-weight: 700; }
.alert-box--error { background: #fff1f2; color: #b91c1c; border: 1px solid #fecdd3; }
.alert-box--success { background: #ecfeff; color: #0f766e; border: 1px solid #a5f3fc; }

@media (max-width: 900px) {
  .panel-grid { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .profile-card { padding: 1rem; border-radius: 22px; }
  .profile-hero { align-items: flex-start; }
  .avatar-wrap { width: 72px; height: 72px; border-radius: 20px; }
  .hero-copy h2 { font-size: 1.2rem; }
  .primary-btn { width: 100%; }
  .panel-actions { justify-content: stretch; }
}
</style>
