// src/composables/useSupabaseCustomers.js
import { ref, onMounted } from 'vue'
import { getSupabase } from '@/lib/supabase'

export function useSupabaseCustomers() {
  const customers = ref([])
  const supabase = getSupabase()
  const isLoading = ref(false)

  const loadData = async () => {
    isLoading.value = true
    console.log('[Customers] Bắt đầu loadData...')

    const { data, error } = await supabase
      .from('customers')
      .select(`
        id, ticketId, name, phone, model, address, issue,
        status, replacedPart, doneDate, createdAt,
        folderDrive, warehouse, serial, branch
      `)
      .order('id', { ascending: false })
      .limit(300)

    if (error) {
      console.error('[Customers] Load error:', error.message)
    } else {
      console.log('[Customers] Load thành công, số ca:', data?.length || 0)
      customers.value = data || []
    }

    isLoading.value = false
  }

  const loadMediaForItem = async (id) => {
    const { data, error } = await supabase
      .from('customers')
      .select('media')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('[Media] Load error:', error.message)
      return []
    }
    return data?.media || []
  }

  onMounted(() => {
    loadData()
  })

  return {
    customers,
    loadData,
    loadMediaForItem, // ← quan trọng, phải có dòng này
    isLoading
  }
}