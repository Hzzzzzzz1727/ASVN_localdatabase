<script setup>
import { computed, onMounted, ref } from 'vue'
import LoginPage from '@/components/LoginPage.vue'
import AdminPanel from '@/components/AdminPanel.vue'
import UserProfilePanel from '@/components/UserProfilePanel.vue'
import { useAuth } from '@/composables/useAuth'

const { initAuth, isAuthLoading, isLoggedIn, isAdmin, currentProfile, logout } = useAuth()
const activeTab = ref('profile')

const pageTabs = computed(() => (
  isAdmin.value
    ? [
        { id: 'profile', label: 'Ho so' },
        { id: 'users', label: 'Nhan vien' },
      ]
    : [
        { id: 'profile', label: 'Ho so' },
      ]
))

const pageTitle = computed(() => (isAdmin.value ? 'Trung tam tai khoan' : 'Ho so ca nhan'))

const goHome = () => {
  window.location.href = '/index.html'
}

const handleLogout = async () => {
  await logout()
}

onMounted(async () => {
  await initAuth()
})
</script>

<template>
  <div class="workspace-shell">
    <div class="workspace-bg workspace-bg--one"></div>
    <div class="workspace-bg workspace-bg--two"></div>

    <main class="workspace-main">
      <section class="hero-bar">
        <button class="back-link" type="button" @click="goHome">← Ve trang chinh</button>
        <div class="hero-center">
          <div class="hero-kicker">ASVN Account Center</div>
          <h1>{{ pageTitle }}</h1>
          <p>Quan ly thong tin dang nhap, anh dai dien va khu vuc tai khoan tach rieng khoi trang xu ly ca.</p>
        </div>
        <button v-if="isLoggedIn" class="logout-link" type="button" @click="handleLogout">Dang xuat</button>
      </section>

      <section v-if="isAuthLoading" class="state-card">
        <div class="spinner-border text-primary"></div>
        <div>Dang tai tai khoan...</div>
      </section>

      <section v-else-if="!isLoggedIn" class="auth-card">
        <LoginPage />
      </section>

      <section v-else class="workspace-card">
        <div class="workspace-top">
          <div>
            <div class="workspace-kicker">{{ currentProfile?.email }}</div>
            <h2>{{ currentProfile?.full_name || 'Tai khoan' }}</h2>
          </div>
          <div class="workspace-tabs">
            <button
              v-for="tab in pageTabs"
              :key="tab.id"
              :class="['workspace-tab', { 'workspace-tab--active': activeTab === tab.id }]"
              type="button"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>

        <UserProfilePanel v-if="activeTab === 'profile'" />

        <section v-else-if="activeTab === 'users' && isAdmin" class="users-panel">
          <AdminPanel />
        </section>
      </section>
    </main>
  </div>
</template>

<style scoped>
.workspace-shell {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(14, 165, 233, 0.16), transparent 30%),
    radial-gradient(circle at bottom right, rgba(16, 185, 129, 0.14), transparent 28%),
    linear-gradient(180deg, #f4fbff 0%, #eef6ff 42%, #f8fafc 100%);
}
.workspace-bg { position: absolute; border-radius: 999px; filter: blur(12px); opacity: 0.7; }
.workspace-bg--one { width: 320px; height: 320px; background: rgba(34, 197, 94, 0.08); top: -120px; right: -80px; }
.workspace-bg--two { width: 420px; height: 420px; background: rgba(2, 132, 199, 0.08); bottom: -180px; left: -120px; }
.workspace-main { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; padding: 1.5rem 1rem 2rem; }
.hero-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1.1rem;
}
.hero-center { text-align: center; }
.hero-kicker, .workspace-kicker { color: #0891b2; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.74rem; font-weight: 800; }
.hero-center h1, .workspace-top h2 { margin: 0.2rem 0 0; color: #0f172a; font-weight: 900; letter-spacing: -0.03em; }
.hero-center h1 { font-size: 2.1rem; }
.hero-center p { margin: 0.45rem auto 0; max-width: 720px; color: #475569; }
.back-link, .logout-link {
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255,255,255,0.72);
  color: #0f172a;
  border-radius: 999px;
  padding: 0.7rem 1rem;
  font-weight: 700;
  backdrop-filter: blur(10px);
}
.logout-link { background: #0f172a; color: #fff; border-color: #0f172a; }
.state-card, .auth-card, .workspace-card {
  background: rgba(255,255,255,0.78);
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 30px;
  box-shadow: 0 28px 60px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(12px);
}
.state-card { min-height: 220px; display: flex; flex-direction: column; gap: 0.8rem; align-items: center; justify-content: center; color: #334155; font-weight: 700; }
.auth-card { padding: 0.2rem; overflow: hidden; }
.workspace-card { padding: 1.1rem; }
.workspace-top {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 0.2rem 0.2rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 1rem;
}
.workspace-tabs { display: inline-flex; gap: 0.5rem; background: #e2e8f0; padding: 0.35rem; border-radius: 999px; }
.workspace-tab {
  border: none;
  background: transparent;
  color: #475569;
  border-radius: 999px;
  padding: 0.65rem 1rem;
  font-weight: 800;
}
.workspace-tab--active {
  background: linear-gradient(135deg, #0284c7, #2563eb);
  color: #fff;
  box-shadow: 0 12px 20px rgba(37, 99, 235, 0.16);
}
.users-panel { padding: 0.25rem; }

@media (max-width: 900px) {
  .hero-bar { grid-template-columns: 1fr; }
  .hero-center { text-align: left; }
  .workspace-top { flex-direction: column; align-items: flex-start; }
}

@media (max-width: 640px) {
  .workspace-main { padding: 0.85rem 0.55rem 1.5rem; }
  .hero-center h1 { font-size: 1.55rem; }
  .workspace-card, .state-card, .auth-card { border-radius: 22px; }
  .workspace-tabs { width: 100%; }
  .workspace-tab { flex: 1; }
}
</style>
