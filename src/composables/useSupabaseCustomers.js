// src/composables/useSupabaseCustomers.js
import { ref, onMounted } from 'vue'
import { getSupabase } from '@/lib/supabase'  // giữ nguyên cách import của anh

export function useSupabaseCustomers() {
  const customers = ref([])
  const supabase = getSupabase()
  const isLoading = ref(false)

const loadData = async () => {
  isLoading.value = true
  console.log('[Customers] Bắt đầu loadData...')

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('id', { ascending: false })

  if (error) {
    console.error('[Customers] Load error:', error.message)
  } else {
    console.log('[Customers] Load thành công, số ca:', data?.length || 0)
    // Force copy array mới + deep clone để Vue reactivity chắc chắn trigger
    customers.value = JSON.parse(JSON.stringify(data || []))  // hoặc [...data.map(item => ({ ...item }))]
    console.log('[Customers] Đã gán customers.value mới')
  }

  isLoading.value = false
}

  // Tự load lần đầu khi composable được dùng
  onMounted(() => {
    loadData()
  })

  return {
    customers,
    loadData,
    isLoading
  }
}