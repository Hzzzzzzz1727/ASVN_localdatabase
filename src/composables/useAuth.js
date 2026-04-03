import { ref, computed } from 'vue'
import { getSupabase } from '@/lib/supabase'

const supabase = getSupabase()

const currentUser = ref(null)
const currentProfile = ref(null)
const isAuthLoading = ref(true)
const lockMessage = ref('')
const isBypassingAuthChange = ref(false)
const PROFILE_COLUMNS = 'id,email,phone,full_name,avatar_url,role,warehouse,is_active,account_status,approval_note,approved_by,approved_at,created_at,updated_at'

const normalizeProfile = (profile) => {
  if (!profile) return null
  return {
    ...profile,
    is_active: profile.is_active !== false,
    account_status: profile.account_status || 'approved',
    approval_note: profile.approval_note || '',
  }
}

export const useAuth = () => {
  const isLoggedIn = computed(() => !!currentUser.value)
  const isAdmin = computed(() => currentProfile.value?.role === 'admin')
  const isNhanVien = computed(() => currentProfile.value?.role === 'nhanvien')
  const userName = computed(() => currentProfile.value?.full_name || currentUser.value?.email || '')
  const userWarehouse = computed(() => currentProfile.value?.warehouse ?? null)

  const canDelete = computed(() => isAdmin.value)
  const canExport = computed(() => isAdmin.value)
  const canManageUsers = computed(() => isAdmin.value)

  const loadProfile = async (userId) => {
    if (!userId) {
      currentProfile.value = null
      return
    }

    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .single()

    currentProfile.value = normalizeProfile(data)
  }

  const refreshProfile = async () => {
    if (!currentUser.value?.id) {
      currentProfile.value = null
      return null
    }
    await loadProfile(currentUser.value.id)
    return currentProfile.value
  }

  const initAuth = async () => {
    isAuthLoading.value = true
    try {
      const { data: { session } } = await supabase.auth.getSession()
      currentUser.value = session?.user ?? null
      if (currentUser.value) await loadProfile(currentUser.value.id)

      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (isBypassingAuthChange.value) return
        if (lockMessage.value) return

        currentUser.value = session?.user ?? null
        if (currentUser.value) {
          try {
            await loadProfile(currentUser.value.id)
          } catch {}
        } else {
          currentProfile.value = null
        }
      })
    } catch (error) {
      console.warn('[initAuth]', error?.message)
    } finally {
      isAuthLoading.value = false
    }
  }

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    const { data: profile } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', data.user.id)
      .single()

    const normalizedProfile = normalizeProfile(profile)
    if (normalizedProfile && !normalizedProfile.is_active) {
      lockMessage.value = 'Tài khoản của bạn đã bị khóa, hãy liên hệ với MIH'
      await supabase.auth.signOut()
      await new Promise((resolve) => setTimeout(resolve, 100))
      lockMessage.value = ''
      currentUser.value = null
      currentProfile.value = null
      throw new Error('Tài khoản của bạn đã bị khóa, hãy liên hệ với MIH')
    }

    currentUser.value = data.user
    currentProfile.value = normalizedProfile
    return data
  }

  const register = async ({ email, password, fullName, phone }) => {
    const { data, error } = await supabase.auth.register({ email, password, fullName, phone })
    if (error) throw error
    return data
  }

  const logout = async () => {
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ])
    } catch {}

    currentUser.value = null
    currentProfile.value = null
    lockMessage.value = ''
  }

  const createNhanVien = async ({ email, password, fullName, warehouse, phone = null }) => {
    isBypassingAuthChange.value = true
    try {
      const { data: { session: adminSession } } = await supabase.auth.getSession()

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone,
            role: 'nhanvien',
            warehouse: warehouse || null,
          },
        },
      })
      if (error) throw error

      if (adminSession) {
        await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
          user: adminSession.user,
        })
        currentUser.value = adminSession.user
        await loadProfile(adminSession.user.id)
      }

      return data.user
    } finally {
      isBypassingAuthChange.value = false
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        currentUser.value = session.user
      }
    }
  }

  const reviewRegistration = async ({ id, approved, note }) => {
    const { data, error } = await supabase.auth.reviewRegistration({ id, approved, note })
    if (error) throw error
    return normalizeProfile(data?.profile)
  }

  const getAllProfiles = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data || []).map(normalizeProfile)
  }

  const toggleUserActive = async (userId, isActive) => {
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', userId)
    if (error) throw error
  }

  const deleteUser = async (userId) => {
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId)
    if (error) throw error
  }

  const updateProfile = async (userId, updates) => {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .single()
    if (error) throw error
    const normalized = normalizeProfile(data)
    if (normalized && currentProfile.value?.id === userId) {
      currentProfile.value = normalized
    }
    return normalized
  }

  const changePassword = async ({ currentPassword, newPassword }) => {
    const { data, error } = await supabase.auth.changePassword({ currentPassword, newPassword })
    if (error) throw error
    return data
  }

  return {
    currentUser,
    currentProfile,
    isAuthLoading,
    lockMessage,
    isLoggedIn,
    isAdmin,
    isNhanVien,
    userName,
    userWarehouse,
    canDelete,
    canExport,
    canManageUsers,
    initAuth,
    login,
    register,
    logout,
    createNhanVien,
    getAllProfiles,
    reviewRegistration,
    toggleUserActive,
    deleteUser,
    updateProfile,
    refreshProfile,
    changePassword,
  }
}
