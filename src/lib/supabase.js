
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://aitgsajahebfyppfxkxi.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdGdzYWphaGViZnlwcGZ4a3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5ODQ2MDcsImV4cCI6MjA4NDU2MDYwN30.TYhSle7DivWo8L10Hr3zN9waOfObYd7DxW544CGalS8'

let supabaseInstance = null

export const getSupabase = () => {
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'tv-repair-auth',
        storage: window.localStorage,
        flowType: 'implicit',
        lock: async (name, acquireTimeout, fn) => fn()
      }
    })
  }
  return supabaseInstance
}