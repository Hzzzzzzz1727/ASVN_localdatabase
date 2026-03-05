// src/composables/useLinhKienManager.js
import { ref } from 'vue'
import { getSupabase } from '@/lib/supabase'

export function useLinhKienManager(loadDataCallback) {
  const supabase = getSupabase()

  const searchTicketId = ref('')
  const newReplacedPart = ref('')
  const editingPart = ref(false)
  const showPartModal = ref(false)

  const linhKienList = ref([
    'Đổi TV',
    'Thay màn hình',
    'Thay bo chính',
    'Thay bo nguồn',
    'Thay Tcon',
    'Thay Led'
  ])

  const openPartModal = () => {
    showPartModal.value = true
  }

  const closePartModal = () => {
    showPartModal.value = false
  }

  const selectPart = (part) => {
    newReplacedPart.value = part
    closePartModal()
  }

  const loadPartForEdit = async () => {
    if (!searchTicketId.value.trim()) {
      alert('Vui lòng nhập mã ASVN')
      return
    }

    const ticket = searchTicketId.value.trim().toUpperCase()

    const { data: ca, error } = await supabase
      .from('customers')
      .select('id, replacedPart')
      .eq('ticketId', ticket)
      .maybeSingle()

    if (error) {
      alert('Lỗi tìm ca: ' + error.message)
      return
    }
    if (!ca) {
      alert('Không tìm thấy ca với mã ASVN: ' + ticket)
      return
    }

    const defaultValues = ['Chưa có linh kiện thay', 'Chưa nhập linh kiện', '']
    if (ca.replacedPart && !defaultValues.includes(ca.replacedPart.trim())) {
      newReplacedPart.value = ca.replacedPart
      editingPart.value = true
    } else {
      newReplacedPart.value = ''
      editingPart.value = false
    }
  }

  const saveLinhKien = async () => {
    if (!searchTicketId.value.trim()) {
      alert('Vui lòng nhập mã ASVN')
      return
    }
    if (!newReplacedPart.value.trim()) {
      alert('Vui lòng nhập/chọn loại linh kiện thay')
      return
    }

    const ticket = searchTicketId.value.trim().toUpperCase()

    const { data: ca, error: errFind } = await supabase
      .from('customers')
      .select('id')
      .eq('ticketId', ticket)
      .maybeSingle()

    if (errFind) {
      alert('Lỗi tìm ca: ' + errFind.message)
      return
    }
    if (!ca) {
      alert('Không tìm thấy ca với mã ASVN: ' + ticket)
      return
    }

    const { error: errUpdate } = await supabase
      .from('customers')
      .update({ replacedPart: newReplacedPart.value.trim() })
      .eq('id', ca.id)

    if (errUpdate) {
      alert('Lỗi cập nhật: ' + errUpdate.message)
      return
    }

    alert(editingPart.value ? 'Đã sửa linh kiện thành công!' : 'Đã lưu linh kiện thay thành công!')
    resetForm()
    if (loadDataCallback) loadDataCallback()
  }

  const deleteLinhKien = async () => {
    if (!searchTicketId.value.trim()) {
      alert('Vui lòng nhập mã ASVN')
      return
    }

    if (!confirm('Bạn có chắc muốn xóa linh kiện của ca này?')) return

    const ticket = searchTicketId.value.trim().toUpperCase()

    const { data: ca, error: errFind } = await supabase
      .from('customers')
      .select('id')
      .eq('ticketId', ticket)
      .maybeSingle()

    if (errFind) {
      alert('Lỗi tìm ca: ' + errFind.message)
      return
    }
    if (!ca) {
      alert('Không tìm thấy ca')
      return
    }

    const { error } = await supabase
      .from('customers')
      .update({ replacedPart: 'Chưa có linh kiện thay' })
      .eq('id', ca.id)

    if (error) {
      alert('Lỗi xóa: ' + error.message)
      return
    }

    alert('Đã xóa linh kiện, reset về mặc định!')
    resetForm()
    if (loadDataCallback) loadDataCallback()
  }

  const resetForm = () => {
    searchTicketId.value = ''
    newReplacedPart.value = ''
    editingPart.value = false
  }

  return {
    searchTicketId,
    newReplacedPart,
    editingPart,
    showPartModal,
    linhKienList,
    openPartModal,
    closePartModal,
    selectPart,
    loadPartForEdit,
    saveLinhKien,
    deleteLinhKien
  }
}