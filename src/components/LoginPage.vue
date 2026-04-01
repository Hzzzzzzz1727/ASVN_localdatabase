<script setup>
import { computed, ref } from 'vue'
import { useAuth } from '@/composables/useAuth'

const { login, register, lockMessage } = useAuth()

const isRegisterMode = ref(false)
const isLoading = ref(false)
const isRegistering = ref(false)
const showPw = ref(false)
const showRegisterPw = ref(false)
const showRegisterConfirmPw = ref(false)
const errorState = ref('')
const successState = ref('')

const email = ref('')
const password = ref('')

const registerName = ref('')
const registerPhone = ref('')
const registerEmail = ref('')
const registerPassword = ref('')
const registerConfirmPassword = ref('')

const errorMsg = computed(() => lockMessage.value || errorState.value)

const resetMessages = () => {
  errorState.value = ''
  successState.value = ''
}

const switchMode = (mode) => {
  isRegisterMode.value = mode === 'register'
  resetMessages()
}

const handleLogin = async () => {
  if (!email.value || !password.value) {
    errorState.value = 'Vui lòng nhập đầy đủ email và mật khẩu!'
    return
  }

  isLoading.value = true
  resetMessages()
  try {
    await login(email.value.trim(), password.value)
  } catch (err) {
    errorState.value =
      err.message === 'Invalid login credentials'
        ? 'Email hoặc mật khẩu không đúng!'
        : err.message
  } finally {
    isLoading.value = false
  }
}

const handleRegister = async () => {
  if (!registerName.value || !registerPhone.value || !registerEmail.value || !registerPassword.value || !registerConfirmPassword.value) {
    errorState.value = 'Vui lòng nhập đủ họ tên, SĐT, email, mật khẩu và xác nhận mật khẩu!'
    return
  }
  if (registerPassword.value.length < 6) {
    errorState.value = 'Mật khẩu tối thiểu 6 ký tự!'
    return
  }
  if (registerPassword.value !== registerConfirmPassword.value) {
    errorState.value = 'Mật khẩu xác nhận chưa khớp!'
    return
  }

  isRegistering.value = true
  resetMessages()
  try {
    const result = await register({
      fullName: registerName.value.trim(),
      phone: registerPhone.value.trim(),
      email: registerEmail.value.trim(),
      password: registerPassword.value,
    })
    successState.value = result?.message || 'Đăng ký thành công, hãy đợi admin xác nhận.'
    registerName.value = ''
    registerPhone.value = ''
    registerEmail.value = ''
    registerPassword.value = ''
    registerConfirmPassword.value = ''
    isRegisterMode.value = false
  } catch (err) {
    errorState.value = err.message || 'Không đăng ký được tài khoản.'
  } finally {
    isRegistering.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="brand">
        <div class="brand-icon">📺</div>
        <h1 class="brand-title">TV Repair Manager</h1>
        <p class="brand-sub">Hệ thống quản lý ca sửa chữa</p>
      </div>

      <div class="mode-switch">
        <button :class="['mode-btn', { active: !isRegisterMode }]" type="button" @click="switchMode('login')">Đăng nhập</button>
        <button :class="['mode-btn', { active: isRegisterMode }]" type="button" @click="switchMode('register')">Đăng ký</button>
      </div>

      <template v-if="!isRegisterMode">
        <div class="form-group">
          <label>Email</label>
          <input v-model="email" type="email" class="form-input" placeholder="your@email.com" :disabled="isLoading" @keyup.enter="handleLogin" />
        </div>

        <div class="form-group">
          <label>Mật khẩu</label>
          <div class="pw-wrap">
            <input v-model="password" :type="showPw ? 'text' : 'password'" class="form-input" placeholder="••••••••" :disabled="isLoading" @keyup.enter="handleLogin" />
            <button class="eye-btn" type="button" @click="showPw = !showPw" tabindex="-1">
              {{ showPw ? '🙈' : '👁️' }}
            </button>
          </div>
        </div>

        <div v-if="errorMsg" class="error-box">⚠️ {{ errorMsg }}</div>
        <div v-if="successState" class="success-box">{{ successState }}</div>

        <button class="login-btn" :disabled="isLoading" @click="handleLogin">
          <span v-if="isLoading" class="spin"></span>
          {{ isLoading ? 'Đang đăng nhập...' : 'Đăng nhập' }}
        </button>

        <p class="hint">Liên hệ admin để được cấp tài khoản</p>
      </template>

      <template v-else>
        <div class="form-group">
          <label>Họ tên</label>
          <input v-model="registerName" type="text" class="form-input" placeholder="Nguyễn Văn A" :disabled="isRegistering" />
        </div>

        <div class="form-group">
          <label>Số điện thoại</label>
          <input v-model="registerPhone" type="tel" class="form-input" placeholder="090xxxxxxx" :disabled="isRegistering" />
        </div>

        <div class="form-group">
          <label>Email</label>
          <input v-model="registerEmail" type="email" class="form-input" placeholder="you@email.com" :disabled="isRegistering" />
        </div>

        <div class="form-group">
          <label>Mật khẩu</label>
          <div class="pw-wrap">
            <input v-model="registerPassword" :type="showRegisterPw ? 'text' : 'password'" class="form-input" placeholder="Tối thiểu 6 ký tự" :disabled="isRegistering" />
            <button class="eye-btn" type="button" @click="showRegisterPw = !showRegisterPw" tabindex="-1">
              {{ showRegisterPw ? '🙈' : '👁️' }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label>Xác nhận mật khẩu</label>
          <div class="pw-wrap">
            <input v-model="registerConfirmPassword" :type="showRegisterConfirmPw ? 'text' : 'password'" class="form-input" placeholder="Nhập lại mật khẩu" :disabled="isRegistering" @keyup.enter="handleRegister" />
            <button class="eye-btn" type="button" @click="showRegisterConfirmPw = !showRegisterConfirmPw" tabindex="-1">
              {{ showRegisterConfirmPw ? '🙈' : '👁️' }}
            </button>
          </div>
        </div>

        <div v-if="errorMsg" class="error-box">⚠️ {{ errorMsg }}</div>
        <div v-if="successState" class="success-box">{{ successState }}</div>

        <button class="login-btn" :disabled="isRegistering" @click="handleRegister">
          <span v-if="isRegistering" class="spin"></span>
          {{ isRegistering ? 'Đang đăng ký...' : 'Tạo tài khoản' }}
        </button>

        <p class="hint">Đăng ký thành công sẽ chờ admin xác nhận trước khi vào hệ thống</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1e3a5f 0%, #0f2544 60%, #1a3a6b 100%);
  padding: 1rem;
  font-family: system-ui, -apple-system, sans-serif;
}

.login-card {
  background: #fff;
  border-radius: 24px;
  padding: 2.5rem 2rem;
  width: 100%;
  max-width: 440px;
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45);
}

.brand {
  text-align: center;
  margin-bottom: 2rem;
}

.brand-icon {
  font-size: 3.5rem;
  display: block;
  margin-bottom: 0.5rem;
}

.brand-title {
  font-size: 1.6rem;
  font-weight: 800;
  color: #1e293b;
  margin: 0 0 0.25rem;
  letter-spacing: -0.03em;
}

.brand-sub {
  color: #64748b;
  font-size: 0.9rem;
  margin: 0;
}

.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.mode-btn {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #334155;
  border-radius: 10px;
  padding: 0.7rem 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.mode-btn.active {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  border-color: transparent;
}

.form-group {
  margin-bottom: 1.2rem;
}

.form-group label {
  display: block;
  font-weight: 600;
  font-size: 0.88rem;
  color: #374151;
  margin-bottom: 0.4rem;
}

.form-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  font-size: 1rem;
  color: #1e293b;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-input:disabled {
  background: #f8fafc;
  opacity: 0.7;
}

.pw-wrap {
  position: relative;
}

.pw-wrap .form-input {
  padding-right: 2.75rem;
}

.eye-btn {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  padding: 0;
  line-height: 1;
}

.error-box {
  background: #fee2e2;
  border: 1px solid #fca5a5;
  color: #991b1b;
  padding: 0.7rem 1rem;
  border-radius: 10px;
  font-size: 0.88rem;
  margin-bottom: 1rem;
  font-weight: 500;
}

.success-box {
  background: #dcfce7;
  border: 1px solid #86efac;
  color: #166534;
  padding: 0.7rem 1rem;
  border-radius: 10px;
  font-size: 0.88rem;
  margin-bottom: 1rem;
  font-weight: 600;
}

.login-btn {
  width: 100%;
  padding: 0.875rem;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.login-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
}

.login-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
}

.spin {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.hint {
  text-align: center;
  color: #94a3b8;
  font-size: 0.82rem;
  margin: 0;
}
</style>
