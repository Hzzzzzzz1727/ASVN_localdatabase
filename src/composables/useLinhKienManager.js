// src/composables/useLinhKienManager.js
import { ref } from 'vue'
import { getSupabase } from '@/lib/supabase'

export function useLinhKienManager(loadDataCallback) {
  const supabase = getSupabase()

  const searchTicketId = ref('')
  const newReplacedPart = ref('')
  const editingPart = ref(false)
  const showPartModal = ref(false)
  const showCustomInput = ref(false) // ← mới: hiện ô nhập tay
  const customPartInput = ref('')    // ← mới: giá trị nhập tay

  const linhKienList = ref([
    'Đổi TV',
    'Thay màn hình',
    'Thay bo chính',
    'Thay bo nguồn',
    'Thay Tcon',
    'Thay Led',
    'Khác' // ← mới
  ])

  const openPartModal = () => {
    showPartModal.value = true
    showCustomInput.value = false
    customPartInput.value = ''
  }

  const closePartModal = () => {
    showPartModal.value = false
    showCustomInput.value = false
    customPartInput.value = ''
  }

  const selectPart = (part) => {
    if (part === 'Khác') {
      // Hiện ô nhập tay thay vì đóng modal
      showCustomInput.value = true
      return
    }
    newReplacedPart.value = part
    closePartModal()
  }

  const confirmCustomPart = () => {
    if (!customPartInput.value.trim()) {
      alert('Vui lòng nhập tên linh kiện!')
      return
    }
    newReplacedPart.value = customPartInput.value.trim()
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

    if (error) { alert('Lỗi tìm ca: ' + error.message); return }
    if (!ca) { alert('Không tìm thấy ca với mã ASVN: ' + ticket); return }

    const defaultValues = ['Chưa có linh kiện thay', 'Chưa nhập linh kiện', 'Chưa có', '']
    if (ca.replacedPart && !defaultValues.includes(ca.replacedPart.trim())) {
      newReplacedPart.value = ca.replacedPart
      editingPart.value = true
    } else {
      newReplacedPart.value = ''
      editingPart.value = false
    }
  }

  const saveLinhKien = async () => {
    if (!searchTicketId.value.trim()) { alert('Vui lòng nhập mã ASVN'); return }
    if (!newReplacedPart.value.trim()) { alert('Vui lòng nhập/chọn loại linh kiện thay'); return }

    const ticket = searchTicketId.value.trim().toUpperCase()

    const { data: ca, error: errFind } = await supabase
      .from('customers').select('id').eq('ticketId', ticket).maybeSingle()

    if (errFind) { alert('Lỗi tìm ca: ' + errFind.message); return }
    if (!ca) { alert('Không tìm thấy ca với mã ASVN: ' + ticket); return }

    const { error: errUpdate } = await supabase
      .from('customers').update({ replacedPart: newReplacedPart.value.trim() }).eq('id', ca.id)

    if (errUpdate) { alert('Lỗi cập nhật: ' + errUpdate.message); return }

    alert(editingPart.value ? 'Đã sửa linh kiện thành công!' : 'Đã lưu linh kiện thay thành công!')
    resetForm()
    if (loadDataCallback) loadDataCallback()
  }

  const deleteLinhKien = async () => {
    if (!searchTicketId.value.trim()) { alert('Vui lòng nhập mã ASVN'); return }
    if (!confirm('Bạn có chắc muốn xóa linh kiện của ca này?')) return

    const ticket = searchTicketId.value.trim().toUpperCase()

    const { data: ca, error: errFind } = await supabase
      .from('customers').select('id').eq('ticketId', ticket).maybeSingle()

    if (errFind) { alert('Lỗi tìm ca: ' + errFind.message); return }
    if (!ca) { alert('Không tìm thấy ca'); return }

    const { error } = await supabase
      .from('customers').update({ replacedPart: 'Chưa có linh kiện thay' }).eq('id', ca.id)

    if (error) { alert('Lỗi xóa: ' + error.message); return }

    alert('Đã xóa linh kiện, reset về mặc định!')
    resetForm()
    if (loadDataCallback) loadDataCallback()
  }

  const resetForm = () => {
    searchTicketId.value = ''
    newReplacedPart.value = ''
    editingPart.value = false
    showCustomInput.value = false
    customPartInput.value = ''
  }

  return {
    searchTicketId,
    newReplacedPart,
    editingPart,
    showPartModal,
    showCustomInput,   // ← export mới
    customPartInput,   // ← export mới
    linhKienList,
    openPartModal,
    closePartModal,
    selectPart,
    confirmCustomPart, // ← export mới
    loadPartForEdit,
    saveLinhKien,
    deleteLinhKien
  }
}