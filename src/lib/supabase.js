// lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://aitgsajahebfyppfxkxi.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdGdzYWphaGViZnlwcGZ4a3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5ODQ2MDcsImV4cCI6MjA4NDU2MDYwN30.TYhSle7DivWo8L10Hr3zN9waOfObYd7DxW544CGalS8'

// Singleton instance
let supabaseInstance = null

export const getSupabase = () => {
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseKey)
    console.log('Supabase client được khởi tạo lần đầu (singleton)')
  }
  return supabaseInstance
}