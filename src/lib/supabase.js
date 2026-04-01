const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '')
const joinUrl = (base, path) => `${normalizeBaseUrl(base)}${path.startsWith('/') ? path : `/${path}`}`
const readRuntimeOverride = (queryKey, storageKey) => {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  const fromQuery = normalizeBaseUrl(params.get(queryKey) || '')
  if (fromQuery) {
    window.localStorage.setItem(storageKey, fromQuery)
    return fromQuery
  }
  return normalizeBaseUrl(window.localStorage.getItem(storageKey) || '')
}

const configuredApiBase = normalizeBaseUrl(
  readRuntimeOverride('apiBase', 'tv-repair-api-base')
  || import.meta.env.VITE_PUBLIC_API_BASE
  || '',
)
const API_BASE = configuredApiBase || '/api'
const MEDIA_BASE = normalizeBaseUrl(
  readRuntimeOverride('mediaBase', 'tv-repair-media-base')
  || import.meta.env.VITE_PUBLIC_MEDIA_BASE
  || (configuredApiBase
    ? configuredApiBase.replace(/\/api$/i, '')
    : ''),
)
const AUTH_STORAGE_KEY = 'tv-repair-local-auth'

let supabaseInstance = null
const authListeners = new Set()

const readAuthState = () => {
  try {
    return JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || 'null')
  } catch {
    return null
  }
}

const writeAuthState = (state) => {
  if (!state) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state))
}

const emitAuthChange = (event, session) => {
  authListeners.forEach((listener) => {
    try {
      listener(event, session)
    } catch (error) {
      console.error('[local auth listener]', error)
    }
  })
}

const getAuthHeader = () => {
  const state = readAuthState()
  return state?.access_token ? { Authorization: `Bearer ${state.access_token}` } : {}
}

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
      ...(options.headers || {}),
    },
    ...options,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error?.message || `HTTP ${response.status}`)
  }
  return payload
}

class LocalQueryBuilder {
  constructor(tableName) {
    this.tableName = tableName
    this.action = 'select'
    this.columns = '*'
    this.filters = []
    this.values = null
    this.returning = null
    this.orderBy = null
    this.limitValue = null
    this.singleMode = false
    this.maybeSingleMode = false
    this.onConflict = null
  }

  select(columns = '*') {
    if (this.action === 'select') this.columns = columns
    else this.returning = columns
    return this
  }

  insert(values) {
    this.action = 'insert'
    this.values = Array.isArray(values) ? values : [values]
    return this
  }

  update(values) {
    this.action = 'update'
    this.values = values
    return this
  }

  delete() {
    this.action = 'delete'
    return this
  }

  upsert(values, options = {}) {
    this.action = 'upsert'
    this.values = values
    this.onConflict = options.onConflict || null
    return this
  }

  eq(column, value) {
    this.filters.push({ type: 'eq', column, value })
    return this
  }

  gt(column, value) {
    this.filters.push({ type: 'gt', column, value })
    return this
  }

  not(column, operator, value) {
    this.filters.push({ type: 'not', column, operator, value })
    return this
  }

  order(column, options = {}) {
    this.orderBy = { column, ascending: options.ascending !== false }
    return this
  }

  limit(value) {
    this.limitValue = value
    return this
  }

  single() {
    this.singleMode = true
    return this
  }

  maybeSingle() {
    this.maybeSingleMode = true
    return this
  }

  async execute() {
    try {
      const payload = {
        action: this.action,
        columns: this.action === 'select' ? this.columns : undefined,
        filters: this.filters,
        values: this.values,
        returning: this.returning
          ? this.returning.split(',').map((item) => item.trim()).filter(Boolean)
          : null,
        order: this.orderBy,
        limit: this.limitValue,
        single: this.singleMode,
        maybeSingle: this.maybeSingleMode,
        onConflict: this.onConflict,
      }

      const result = await requestJson(`${API_BASE}/db/${this.tableName}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      return { data: result.data, error: result.error || null }
    } catch (error) {
      return { data: null, error: { message: error.message || 'Khong xu ly duoc du lieu local.' } }
    }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject)
  }
}

const createStorageBucket = (bucket) => ({
  getPublicUrl(filePath) {
    const normalized = String(filePath || '')
    return {
      data: {
        publicUrl: /^https?:\/\//i.test(normalized)
          ? normalized
          : joinUrl(MEDIA_BASE || window.location.origin, `/media/${bucket}/${normalized.replace(/^\/+/, '')}`),
      },
    }
  },

  async upload(filePath, file) {
    try {
      const formData = new FormData()
      formData.append('bucket', bucket)
      formData.append('path', filePath)
      formData.append('file', file)

      const response = await fetch(`${API_BASE}/storage/upload`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || 'Khong upload duoc file local.')
      return { data: payload.data, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message || 'Khong upload duoc file local.' } }
    }
  },

  async remove(paths) {
    try {
      const payload = await requestJson(`${API_BASE}/storage/remove`, {
        method: 'POST',
        body: JSON.stringify({ bucket, paths }),
      })
      return { data: payload.data, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message || 'Khong xoa duoc file local.' } }
    }
  },
})

const createChannel = () => ({
  state: 'joined',
  on() { return this },
  subscribe() { return this },
})

const createAuthApi = () => ({
  async getSession() {
    const state = readAuthState()
    if (!state?.access_token) {
      return { data: { session: null }, error: null }
    }

    try {
      const payload = await requestJson(`${API_BASE}/auth/session`, { method: 'GET' })
      const session = payload?.data?.session || null
      writeAuthState(session)
      return { data: { session }, error: null }
    } catch (error) {
      writeAuthState(null)
      return { data: { session: null }, error: { message: error.message || 'Khong doc duoc session local.' } }
    }
  },

  async refreshSession() {
    return this.getSession()
  },

  async signInWithPassword({ email, password }) {
    try {
      const payload = await requestJson(`${API_BASE}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      const session = payload?.data || null
      writeAuthState(session)
      emitAuthChange('SIGNED_IN', session)
      return { data: { user: session?.user || null, session }, error: null }
    } catch (error) {
      return { data: { user: null, session: null }, error: { message: error.message || 'Dang nhap that bai.' } }
    }
  },

  async signOut() {
    try {
      await requestJson(`${API_BASE}/auth/logout`, { method: 'POST' })
    } catch {}
    writeAuthState(null)
    emitAuthChange('SIGNED_OUT', null)
    return { error: null }
  },

  async signUp({ email, password, options = {} }) {
    try {
      const payload = await requestJson(`${API_BASE}/auth/users`, {
        method: 'POST',
        body: JSON.stringify({ email, password, options }),
      })
      return { data: payload.data, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message || 'Khong tao duoc tai khoan local.' } }
    }
  },

  async register({ email, password, fullName, phone }) {
    try {
      const payload = await requestJson(`${API_BASE}/auth/register`, {
        method: 'POST',
        body: JSON.stringify({ email, password, fullName, phone }),
      })
      return { data: payload.data, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message || 'Khong dang ky duoc tai khoan local.' } }
    }
  },

  async reviewRegistration({ id, approved, note }) {
    try {
      const payload = await requestJson(`${API_BASE}/auth/registrations/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ approved, note }),
      })
      return { data: payload.data, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message || 'Khong xu ly duoc dang ky.' } }
    }
  },

  async setSession(session) {
    if (!session?.access_token) {
      writeAuthState(null)
      emitAuthChange('SIGNED_OUT', null)
      return { data: { session: null }, error: null }
    }
    writeAuthState(session)
    emitAuthChange('SIGNED_IN', session)
    return { data: { session }, error: null }
  },

  onAuthStateChange(callback) {
    authListeners.add(callback)
    return {
      data: {
        subscription: {
          unsubscribe: () => authListeners.delete(callback),
        },
      },
    }
  },
})

export const getSupabase = () => {
  if (!supabaseInstance) {
    supabaseInstance = {
      from(tableName) {
        return new LocalQueryBuilder(tableName)
      },

      rpc(name, params) {
        return {
          then(resolve, reject) {
            return requestJson(`${API_BASE}/rpc/${name}`, {
              method: 'POST',
              body: JSON.stringify(params || {}),
            })
              .then((payload) => resolve({ data: payload.data, error: null }))
              .catch((error) => resolve({ data: null, error: { message: error.message || 'Khong goi duoc local RPC.' } }))
          },
        }
      },

      auth: createAuthApi(),

      storage: {
        from(bucket) {
          return createStorageBucket(bucket)
        },
      },

      channel() {
        return createChannel()
      },

      removeChannel() {
        return true
      },
    }
  }

  return supabaseInstance
}
