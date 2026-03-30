import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://aitgsajahebfyppfxkxi.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdGdzYWphaGViZnlwcGZ4a3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5ODQ2MDcsImV4cCI6MjA4NDU2MDYwN30.TYhSle7DivWo8L10Hr3zN9waOfObYd7DxW544CGalS8'

const memoryStorage = (() => {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, value)
    },
    removeItem(key) {
      store.delete(key)
    },
  }
})()

let publicShareSupabase = null

export const getPublicShareSupabase = () => {
  if (!publicShareSupabase) {
    publicShareSupabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'tv-repair-public-share',
        storage: memoryStorage,
        flowType: 'implicit',
        lock: async (_name, _acquireTimeout, fn) => fn(),
      },
      global: {
        headers: {
          'x-share-client': 'public-readonly',
        },
      },
    })
  }
  return publicShareSupabase
}
