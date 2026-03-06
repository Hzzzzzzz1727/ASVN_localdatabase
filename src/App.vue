<script setup>
import { ref, computed, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import { getSupabase } from './lib/supabase'

import { useSupabaseCustomers } from '@/composables/useSupabaseCustomers'
import { useTicketParser } from '@/composables/useTicketParser'
import { useGeocodingAndRouting } from '@/composables/useGeocodingAndRouting'
import { useLinhKienManager } from '@/composables/useLinhKienManager'

// === SUPABASE & CUSTOMERS ===
const searchQuery = ref('')
const historySearchQuery = ref('')
const { customers, loadData, loadMediaForItem, isLoading } = useSupabaseCustomers()
const supabase = getSupabase()

// === TICKET PARSER ===
const { rawInput, handleParse } = useTicketParser(loadData)

const customHandleParse = async (text) => {
  if (!text || !text.trim()) return

  if (!text.includes('VN-NV') && !text.includes('NV-MSC')) {
    await handleParse(text)
    return
  }

  const ticketIdMatch = text.match(/ASVN\d+/)
  if (!ticketIdMatch) {
    alert('Không tìm thấy mã ASVN!')
    return
  }
  const fullTicketId = ticketIdMatch[0].toUpperCase()

  const { data: exist } = await supabase
    .from('customers')
    .select('ticketId')
    .eq('ticketId', fullTicketId)
    .maybeSingle()
  if (exist) {
    console.log('Ca đã tồn tại:', fullTicketId)
    rawInput.value = ''
    return
  }

  const afterTicket = text.replace(fullTicketId, '').trim()
  const nameMatch = afterTicket.match(
    /^((?:Anh|Chị|chị|Bác|bác|Ông|ông|Bà|bà|Chú|chú|Em|em|Cô|cô|A|C)\s+[^\s,|\n]+)/
  )
  const name = nameMatch ? nameMatch[1].trim() : 'Khách NV'

  const afterName = text.replace(fullTicketId, '').replace(name, '').trim()
  const phoneMatch = afterName.match(/(?<!\d)(?:0[3-9][0-9]{8})(?!\d)/)
  const phone = phoneMatch ? phoneMatch[0].trim() : ''

  const addressMatch = text.match(
    /([^\n]+?(?:Quảng Nam|Đà Nẵng|QUẢNG NAM|ĐÀ NẴNG)[^,\n]*(?:,\s*(?:Huyện|Thị Xã|Quận|TP)[^,\n]*)*)/i
  )
  const address = addressMatch ? addressMatch[0].trim() : 'Địa chỉ Quảng Nam'

  const modelMatch = text.match(/XIAOMI\s*-\s*(.+?)(?=\s*Serial|\s*VN-NV|\n)/i)
  const model = modelMatch ? modelMatch[1].trim() : 'Xiaomi TV'

  const serialMatch = text.match(/Serial:\s*([A-Z0-9\/]+)/i)
  const serial = serialMatch ? serialMatch[1].trim() : ''

  const branchMatch = text.match(/VN-NV-MSC-[^\s,\n]+/i)
  const branch = branchMatch ? branchMatch[0].trim() : 'VN-NV-MSC-Đà Nẵng'

  const issueMatch = text.match(/(?:VN-NV-MSC-[^\s]+)\s*(.+?)(?:\d{2}\/\d{2}\/\d{4}|Tồn:|$)/i)
  const issue = issueMatch ? issueMatch[1].trim() : 'Bảo hành TV'

  const newCa = {
    ticketId: fullTicketId,
    name, phone, model, address, issue,
    media: [], folderDrive: '', status: 0,
    replacedPart: 'Chưa có', doneDate: null,
    createdAt: new Date().toISOString(),
    warehouse: 'NV', serial, branch
  }

  console.log('📋 Ca NV sẽ lưu:', JSON.stringify(newCa, null, 2))

  const { error } = await supabase.from('customers').insert([newCa])
  if (error) {
    console.error('Lỗi insert NV:', error)
    alert('Lỗi lưu ca NV: ' + error.message)
  } else {
    alert(`✅ Đã lưu ca NV!\nMã: ${fullTicketId}\nTên: ${name}\nModel: ${model}\nĐịa chỉ: ${address}`)
    await loadData()
  }
  rawInput.value = ''
}

// === ROUTING ===
const routing = useGeocodingAndRouting({ value: customers })
const {
  currentLocation, currentCoords, showRouteModal,
  routeCustomers, isLoadingRoute,
  openRouteModal, closeRouteModal, calculateRoute
} = routing

// === LINH KIỆN MANAGER ===
const linhKien = useLinhKienManager(loadData)
const {
  searchTicketId, newReplacedPart, editingPart,
  showPartModal, linhKienList,
  showCustomInput, customPartInput, confirmCustomPart,
  openPartModal, closePartModal, selectPart,
  loadPartForEdit, saveLinhKien, deleteLinhKien
} = linhKien

// === LOẠI CA VÀ KHO ===
const currentType = ref('ASVN')
const showWarehouse = ref(true)
const currentWarehouse = ref('TDP')
const isEditingLink = ref({})
const tempFolderLink = ref({})

// === TABS ===
const showTab = ref('danglam')

// === MODALS ===
const showDetailModal = ref(false)
const selectedCustomer = ref(null)
const showModal = ref(false)
const modalMedia = ref(null)
const showTreModal = ref(false)
const showOutsideForm = ref(false)
const outsideForm = ref({ name: '', phone: '', brand: '', model: '', issue: '' })

// === MODAL CHI TIẾT CA NGOÀI ===
const showOutsideDetailModal = ref(false)
const selectedOutside = ref(null)
const editingOutsidePart = ref('')

const openOutsideDetailModal = async (item) => {
  selectedOutside.value = { ...item, media: [] }
  editingOutsidePart.value = item.replacedPart || ''
  showOutsideDetailModal.value = true
  document.body.style.overflow = 'hidden'
  const media = await loadMediaForItem(item.id)
  if (selectedOutside.value) {
    selectedOutside.value = { ...selectedOutside.value, media }
  }
}

const closeOutsideDetailModal = () => {
  showOutsideDetailModal.value = false
  selectedOutside.value = null
  document.body.style.overflow = ''
}

const saveOutsidePart = async () => {
  if (!selectedOutside.value) return
  await supabase.from('customers')
    .update({ replacedPart: editingOutsidePart.value })
    .eq('id', selectedOutside.value.id)
  selectedOutside.value.replacedPart = editingOutsidePart.value
  await loadData()
  alert('Đã lưu linh kiện!')
}

const changeOutsideStatus = async (status) => {
  if (!selectedOutside.value) return
  const now = new Date()
  const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`
  const updates = status === 2 ? { status, doneDate: dateStr } : { status, doneDate: null }
  await supabase.from('customers').update(updates).eq('id', selectedOutside.value.id)
  selectedOutside.value = { ...selectedOutside.value, ...updates }
  await loadData()
}

const openTreModal = () => showTreModal.value = true
const closeTreModal = () => showTreModal.value = false

const openMediaModal = (media) => {
  modalMedia.value = media
  showModal.value = true
  document.body.style.overflow = 'hidden'
}
const closeMediaModal = () => {
  showModal.value = false
  modalMedia.value = null
  document.body.style.overflow = ''
}

const openDetailModal = async (customer) => {
  selectedCustomer.value = { ...customer, media: [] }
  showDetailModal.value = true
  document.body.style.overflow = 'hidden'
  const media = await loadMediaForItem(customer.id)
  if (selectedCustomer.value) {
    selectedCustomer.value = { ...selectedCustomer.value, media }
  }
}
const closeDetailModal = () => {
  showDetailModal.value = false
  selectedCustomer.value = null
  document.body.style.overflow = ''
}

const backToTypeToggle = () => {
  showWarehouse.value = false
  currentType.value = 'ASVN'
}

const selectWarehouse = (wh) => {
  currentWarehouse.value = wh
}

// === COMPUTED ===
const filteredCustomers = computed(() => {
  let filtered = customers.value

  if (currentType.value === 'ASVN') filtered = filtered.filter(c => c.ticketId?.startsWith('ASVN'))
  else if (currentType.value === 'CSVN') filtered = filtered.filter(c => c.ticketId?.startsWith('CSVN'))
  else if (currentType.value === 'OUTSIDE') filtered = filtered.filter(c => c.ticketId?.startsWith('NGOAI'))

  if (currentType.value === 'ASVN' && showWarehouse.value) {
    const q = searchQuery.value.toLowerCase()
    if (!q) {
      filtered = filtered.filter(c => c.warehouse === currentWarehouse.value)
    }
  }

  const q = searchQuery.value.toLowerCase()
  return filtered.filter(c =>
    c.name?.toLowerCase().includes(q) ||
    c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) ||
    c.model?.toLowerCase().includes(q) ||
    c.replacedPart?.toLowerCase().includes(q)
  )
})

const dangLam = computed(() => filteredCustomers.value.filter(c => c.status === 0))

const choLinhKien = computed(() => {
  const q = searchQuery.value.toLowerCase()
  let items = filteredCustomers.value.filter(c => c.status === 1)
  if (currentType.value === 'ASVN' && showWarehouse.value && !q) {
    items = items.filter(c => c.warehouse === currentWarehouse.value)
  }
  return items.filter(c =>
    c.name?.toLowerCase().includes(q) ||
    c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) ||
    c.model?.toLowerCase().includes(q) ||
    c.replacedPart?.toLowerCase().includes(q)
  )
})

const hoanThanh = computed(() => {
  const q = historySearchQuery.value.toLowerCase()
  let items = filteredCustomers.value.filter(c => c.status === 2)
  if (currentType.value === 'ASVN' && showWarehouse.value && !q) {
    items = items.filter(c => c.warehouse === currentWarehouse.value)
  }
  const filteredItems = items.filter(c =>
    c.name?.toLowerCase().includes(q) ||
    c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) ||
    c.model?.toLowerCase().includes(q) ||
    c.replacedPart?.toLowerCase().includes(q)
  )
  const groups = {}
  filteredItems.forEach(item => {
    const d = item.doneDate || 'N/A'
    if (!groups[d]) groups[d] = []
    groups[d].push(item)
  })
  return groups
})

const treCaList = computed(() => {
  const now = new Date().getTime()
  return filteredCustomers.value.filter(c => {
    if (c.status !== 0) return false
    if (!c.createdAt) return false
    return now - new Date(c.createdAt).getTime() > 86400000
  })
})

const getWarehouseLabel = (item) => {
  if (!item.warehouse) return ''
  return item.warehouse === 'TDP' ? 'Kho TDP' : 'Kho NV'
}
const getWarehouseBadgeClass = (wh) => wh === 'TDP' ? 'bg-primary' : 'bg-success'

// === FORM CA NGOÀI ===
const openOutsideForm = () => {
  showOutsideForm.value = true
  outsideForm.value = { phone: '', brand: '', model: '', issue: '' }
}
const closeOutsideForm = () => showOutsideForm.value = false

const saveOutsideCa = async () => {
  if (!outsideForm.value.phone || !outsideForm.value.issue) {
    alert('Vui lòng nhập SĐT và tình trạng TV!')
    return
  }
  const now = new Date()
  const ticketId = `NGOAI-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`

  const newCa = {
    ticketId, name: outsideForm.value.name.trim() || 'Khách ngoài', phone: outsideForm.value.phone,
    model: `${outsideForm.value.brand} ${outsideForm.value.model}`.trim() || 'Chưa rõ',
    address: 'Ca ngoài - không có địa chỉ', issue: outsideForm.value.issue,
    media: [], folderDrive: '', status: 0,
    replacedPart: 'Chưa có linh kiện thay', doneDate: null,
    createdAt: now.toISOString(), warehouse: 'TDP'
  }

  const { error } = await supabase.from('customers').insert([newCa])
  if (error) { alert('Lỗi lưu ca ngoài: ' + error.message); return }

  alert('Đã nhận ca ngoài thành công! Mã: ' + ticketId)
  closeOutsideForm()
  loadData()
}

const selectTreCa = (item) => {
  searchQuery.value = item.ticketId
  closeTreModal()
}

// === ON MOUNTED ===
onMounted(() => {
  loadData()
  currentType.value = 'ASVN'
  showWarehouse.value = true
  currentWarehouse.value = 'TDP'

  const channel = new BroadcastChannel('zalo_bridge')
  channel.onmessage = (event) => { if (event.data) customHandleParse(event.data) }

  window.addEventListener('focus', async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && (text.includes('ASVN') || text.includes('CSVN'))) customHandleParse(text)
    } catch (err) {}
  })
})

// === MEDIA ===
const formatDriveLink = (link) => {
  if (!link) return null
  const driveIdMatch = link.match(/id=([^&]+)|d\/([^/]+)/)
  if (driveIdMatch) {
    const id = driveIdMatch[1] || driveIdMatch[2]
    return `https://lh3.googleusercontent.com/d/${id}`
  }
  return link
}

const onFileChange = async (e, item) => {
  const files = Array.from(e.target.files)
  const currentMedia = await loadMediaForItem(item.id)
  for (const file of files) {
    const reader = new FileReader()
    const base64 = await new Promise(r => { reader.onload = () => r(reader.result); reader.readAsDataURL(file) })
    currentMedia.push({ type: file.type.startsWith('video') ? 'video' : 'image', data: base64, source: 'local' })
  }
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  if (showDetailModal.value && selectedCustomer.value?.id === item.id) {
    selectedCustomer.value = { ...selectedCustomer.value, media: currentMedia }
  }
  if (showOutsideDetailModal.value && selectedOutside.value?.id === item.id) {
    selectedOutside.value = { ...selectedOutside.value, media: currentMedia }
  }
}

const addSingleDrive = async (item) => {
  const inputEl = document.getElementById(`single-drive-${item.id}`)
  if (!inputEl || !inputEl.value.trim()) return
  const currentMedia = await loadMediaForItem(item.id)
  const link = inputEl.value.trim()
  currentMedia.push({ type: 'image', data: formatDriveLink(link), source: 'drive', original: link })
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  inputEl.value = ''
  if (showDetailModal.value && selectedCustomer.value?.id === item.id) {
    selectedCustomer.value = { ...selectedCustomer.value, media: currentMedia }
  }
  if (showOutsideDetailModal.value && selectedOutside.value?.id === item.id) {
    selectedOutside.value = { ...selectedOutside.value, media: currentMedia }
  }
}

const removeMedia = async (item, index) => {
  const currentMedia = await loadMediaForItem(item.id)
  currentMedia.splice(index, 1)
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  if (showDetailModal.value && selectedCustomer.value?.id === item.id) {
    selectedCustomer.value = { ...selectedCustomer.value, media: currentMedia }
  }
  if (showOutsideDetailModal.value && selectedOutside.value?.id === item.id) {
    selectedOutside.value = { ...selectedOutside.value, media: currentMedia }
  }
}

// === TRẠNG THÁI CA ===
const hoanTatKiemTra = async (item) => {
  await supabase.from('customers').update({ status: 1 }).eq('id', item.id)
  await loadData()
}

const dongCa = async (item) => {
  const now = new Date()
  const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`
  await supabase.from('customers').update({ status: 2, doneDate: dateStr }).eq('id', item.id)
  await loadData()
}

const revertToDangLam = async (item) => {
  await supabase.from('customers').update({ status: 0, doneDate: null }).eq('id', item.id)
  await loadData()
  if (showDetailModal.value) closeDetailModal()
}

const deleteCustomer = async (id) => {
  const item = customers.value.find(c => c.id === id)
  if (!item) return alert('Ca không tồn tại!')

  let confirmed = false
  if (showWarehouse.value && currentType.value === 'ASVN' && item.warehouse && item.warehouse !== currentWarehouse.value) {
    confirmed = confirm(`Ca này thuộc kho ${item.warehouse}, bạn có chắc xóa?`)
  } else {
    confirmed = confirm('Bạn có chắc chắn muốn xóa ca này?')
  }
  if (!confirmed) return

  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) {
    alert('Lỗi xóa: ' + error.message)
  } else {
    alert('Đã xóa ca thành công!')
    await loadData()
  }
  if (showDetailModal.value) closeDetailModal()
  if (showOutsideDetailModal.value) closeOutsideDetailModal()
}

const startEditFolder = (id, currentLink) => {
  isEditingLink.value[id] = true
  tempFolderLink.value[id] = currentLink || ''
}

const saveFolderLink = async (id) => {
  const link = tempFolderLink.value[id]
  await supabase.from('customers').update({ folderDrive: link }).eq('id', id)
  isEditingLink.value[id] = false
  if (showDetailModal.value && selectedCustomer.value?.id === id) {
    selectedCustomer.value.folderDrive = link
  }
  if (showOutsideDetailModal.value && selectedOutside.value?.id === id) {
    selectedOutside.value.folderDrive = link
  }
  await loadData()
}

const formatDate = (dateStr) => {
  if (!dateStr) return 'Chưa có ngày tạo'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return 'Ngày không hợp lệ'
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// === EXPORT EXCEL ===
const exportToExcel = (data, fileName) => {
  if (!data.length) return alert('Không có dữ liệu!')
  const excelData = data.map(item => ({
    'Kho': item.warehouse || 'N/A',
    'Mã Ca': item.ticketId, 'Ngày Hoàn thành': item.doneDate,
    'Khách Hàng': item.name, 'SĐT': item.phone,
    'Model': item.model, 'Địa Chỉ': item.address,
    'Lỗi': item.issue, 'Linh kiện thay': item.replacedPart
  }))
  const ws = XLSX.utils.json_to_sheet(excelData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Báo Cáo')
  XLSX.writeFile(wb, `${fileName}.xlsx`)
}

const exportHoanThanhByWarehouse = (wh) => {
  const data = customers.value.filter(c => c.status === 2 && c.ticketId?.startsWith('ASVN') && c.warehouse === wh)
  if (!data.length) return alert(`Không có dữ liệu hoàn thành cho ${wh}!`)
  exportToExcel(data, `Bao-Cao-Hoan-Thanh-${wh}`)
}

const exportAllHoanThanh = () => {
  const data = customers.value.filter(c => c.status === 2 && c.ticketId?.startsWith('ASVN'))
  if (!data.length) return alert('Không có dữ liệu!')
  exportToExcel(data, 'Bao-Cao-Hoan-Thanh-All')
}

const getStatusClass = (status) => {
  if (status === 0) return { border: 'border-primary', badge: 'bg-secondary', label: 'Chờ xử lý', color: 'text-primary' }
  if (status === 1) return { border: 'border-warning', badge: 'bg-warning text-dark', label: 'Chờ linh kiện', color: 'text-warning' }
  if (status === 2) return { border: 'border-success', badge: 'bg-success text-white', label: 'Hoàn thành', color: 'text-success' }
  return { border: '', badge: '', label: '', color: '' }
}
</script>

<template>
  <div class="page-wrap">
    <div class="layout">
      <div class="control-card">
        <!-- Toggle loại ca -->
        <div v-if="!showWarehouse || currentType !== 'ASVN'" class="toggle-row">
          <button @click="currentType = 'ASVN'; showTab = 'danglam'; showWarehouse = true; currentWarehouse = 'TDP'"
            :class="['btn fw-bold flex-grow-1', currentType === 'ASVN' ? 'btn-primary text-white' : 'btn-outline-primary']">
            📋 ASVN
          </button>
          <button @click="currentType = 'CSVN'; showTab = 'danglam'; showWarehouse = false"
            :class="['btn fw-bold flex-grow-1', currentType === 'CSVN' ? 'btn-primary text-white' : 'btn-outline-primary']">
            📋 CSVN
          </button>
          <button @click="currentType = 'OUTSIDE'; showTab = 'danglam'; showWarehouse = false"
            :class="['btn fw-bold flex-grow-1', currentType === 'OUTSIDE' ? 'btn-primary text-white' : 'btn-outline-primary']">
            📝 Ca Ngoài
          </button>
        </div>

        <!-- Warehouse toggle -->
        <div v-if="showWarehouse && currentType === 'ASVN'" class="warehouse-toggle-row">
          <div class="gear-container">
            <button @click="backToTypeToggle" class="btn-gear" title="Quay về phân loại loại ca">⚙️</button>
          </div>
          <div class="warehouse-buttons">
            <button @click="selectWarehouse('TDP'); showTab = 'danglam'"
              :class="['btn fw-bold flex-grow-1', currentWarehouse === 'TDP' ? 'btn-primary text-white' : 'btn-outline-primary']">
              🏭 TDP
            </button>
            <button @click="selectWarehouse('NV'); showTab = 'danglam'"
              :class="['btn fw-bold flex-grow-1', currentWarehouse === 'NV' ? 'btn-success text-white' : 'btn-outline-success']">
              🏭 NV
            </button>
          </div>
        </div>

        <!-- 3 tab trạng thái -->
        <div v-if="currentType !== 'OUTSIDE'" class="status-toggle-row">
          <button @click="showTab = 'danglam'" :class="['btn fw-bold flex-grow-1', showTab === 'danglam' ? 'btn-primary text-white' : 'btn-outline-primary']">⚡ ĐANG LÀM ({{ dangLam.length }})</button>
          <button @click="showTab = 'cholinkien'" :class="['btn fw-bold flex-grow-1', showTab === 'cholinkien' ? 'btn-warning text-white' : 'btn-outline-warning']">⏳ CHỜ LINH KIỆN ({{ choLinhKien.length }})</button>
          <button @click="showTab = 'hoanthanh'" :class="['btn fw-bold flex-grow-1', showTab === 'hoanthanh' ? 'btn-success text-white' : 'btn-outline-success']">✅ HOÀN THÀNH ({{ Object.values(hoanThanh).flat().length }})</button>
        </div>

        <!-- Control body -->
        <div v-if="currentType === 'ASVN' || currentType === 'CSVN'">
          <div v-if="showTab === 'danglam'" class="control-body">
            <div class="d-flex justify-content-between align-items-start mb-3">
              <textarea v-model="rawInput" rows="2" class="form-control flex-grow-1 me-3"
                placeholder="Dán nội dung hoặc đợi tin nhắn Zalo..."
                @keyup.enter="customHandleParse(rawInput)"></textarea>
              <div class="position-relative" style="min-width: 50px;">
                <button class="btn btn-outline-warning position-relative rounded-circle p-2 shadow"
                  style="width: 50px; height: 50px; display: flex; align-items: center; justify-content: center;"
                  @click="openTreModal" title="Thông báo ca trễ">
                  <span style="font-size: 1.8rem;">🔔</span>
                  <span v-if="treCaList.length > 0"
                    class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger border border-white"
                    style="font-size: 0.75rem; min-width: 20px; height: 20px; line-height: 1.2; padding: 0;">
                    {{ treCaList.length }}
                  </span>
                </button>
              </div>
            </div>
            <div class="control-actions">
              <button @click="customHandleParse(rawInput)" class="btn btn-primary fw-bold">NHẬP KHÁCH</button>
              <button @click="openRouteModal" class="btn btn-info fw-bold">🗺️ TÍNH HÀNH TRÌNH</button>
              <input type="text" v-model="searchQuery" class="form-control" placeholder="🔍 Tìm kiếm nhanh...">
            </div>
          </div>

          <div v-else-if="showTab === 'cholinkien'" class="control-body">
            <div class="d-flex flex-column gap-3">
              <div class="d-flex gap-3 flex-wrap align-items-end">
                <input v-model="searchTicketId" type="text" class="form-control flex-grow-1"
                  placeholder="Nhập mã ASVN cần cập nhật/sửa linh kiện..." @keyup.enter="loadPartForEdit">
                <button @click="loadPartForEdit" class="btn btn-outline-primary">Tìm</button>
              </div>
              <div class="d-flex gap-3 flex-wrap align-items-end">
                <input v-model="newReplacedPart" type="text" class="form-control flex-grow-1"
                  :placeholder="editingPart ? 'Sửa linh kiện hiện tại...' : 'Loại linh kiện thay...'"
                  @click="openPartModal">
                <button @click="saveLinhKien" class="btn btn-success px-4 fw-bold">
                  {{ editingPart ? 'Sửa linh kiện' : 'Lưu linh kiện' }}
                </button>
                <button v-if="editingPart" @click="deleteLinhKien" class="btn btn-danger px-4 fw-bold">Xóa linh kiện</button>
              </div>
              <input v-model="searchQuery" type="text" class="form-control" placeholder="Tìm theo tên, sđt, mã ca, model TV, linh kiện...">
            </div>
          </div>

          <div v-else-if="showTab === 'hoanthanh'" class="control-body">
            <div class="d-flex gap-2 flex-wrap">
              <input type="text" v-model="historySearchQuery" class="form-control flex-grow-1 mb-2"
                placeholder="🔍 Tìm trong lịch sử hoàn thành...">
              <div v-if="showWarehouse" class="d-flex gap-1 w-100">
                <button @click="exportHoanThanhByWarehouse('TDP')" class="btn btn-outline-primary fw-bold flex-grow-1">📊 TDP</button>
                <button @click="exportHoanThanhByWarehouse('NV')" class="btn btn-outline-success fw-bold flex-grow-1">📊 NV</button>
              </div>
              <button v-else @click="exportAllHoanThanh" class="btn btn-outline-dark fw-bold">📊 XUẤT EXCEL</button>
            </div>
          </div>
        </div>

        <div v-else-if="currentType === 'OUTSIDE'" class="control-body">
          <button @click="openOutsideForm" class="btn btn-success fw-bold w-100 py-3 mb-3">+ NHẬN CA NGOÀI MỚI</button>
          <small class="text-muted d-block text-center">Nhập thông tin khách + TV thủ công (tự tạo mã)</small>
          <input type="text" v-model="searchQuery" class="form-control mt-2" placeholder="🔍 Tìm kiếm nhanh...">
        </div>
      </div>

      <section class="cases-section">
        <div class="section-header">
          <h2 class="section-title">
            {{ currentType === 'ASVN' ? 'Ca ASVN' : currentType === 'CSVN' ? 'Ca CSVN' : 'Ca Ngoài' }}
            <span v-if="showWarehouse && currentType === 'ASVN' && !searchQuery && showTab !== 'hoanthanh'"
              class="badge ms-2" :class="getWarehouseBadgeClass(currentWarehouse)">{{ currentWarehouse }}</span>
          </h2>
        </div>

        <div v-if="currentType !== 'OUTSIDE'">
          <!-- TAB ĐANG LÀM -->
          <div v-if="showTab === 'danglam'">
            <div v-if="dangLam.length > 0">
              <h5 class="mb-3">Đang làm ({{ dangLam.length }})</h5>
              <div class="case-strip">
                <div v-for="item in dangLam" :key="item.id" class="case-card">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-primary d-flex flex-column">
                      <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                          <input type="checkbox" @change="hoanTatKiemTra(item)" style="width: 20px; height: 20px;">
                          <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                          <span v-if="item.warehouse" class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) }}</span>
                          <span class="badge bg-secondary">Chờ xử lý</span>
                        </div>
                        <button @click="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">🗑️ Xóa</button>
                      </div>
                      <div class="info-content">
                        <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                        <div class="fw-bold text-secondary mb-1">📞 {{ item.phone }}</div>
                        <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                        <div class="small text-muted mb-2">📍 {{ item.address }}</div>
                        <div class="text-danger small fw-bold mb-2">⚠️ {{ item.issue }}</div>
                        <div class="text-info small fw-bold mb-3">🔧 Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                        <div class="input-group input-group-sm mb-3 mt-2">
                          <input :id="'single-drive-'+item.id" class="form-control" placeholder="Link ảnh lẻ..." @keyup.enter="addSingleDrive(item)">
                          <button @click="addSingleDrive(item)" class="btn btn-outline-primary">Thêm</button>
                        </div>
                        <div class="mt-auto">
                          <div v-if="!item.folderDrive || isEditingLink[item.id]" class="input-group input-group-sm">
                            <input v-model="tempFolderLink[item.id]" class="form-control" placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(item.id)">
                            <button @click="saveFolderLink(item.id)" class="btn btn-primary">Lưu</button>
                          </div>
                          <div v-else class="d-flex gap-1">
                            <a :href="item.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">📂 DRIVE TỔNG</a>
                            <button @click="startEditFolder(item.id, item.folderDrive)" class="btn btn-sm btn-light border">Sửa</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca đang làm cho loại này</div>
          </div>

          <!-- TAB CHỜ LINH KIỆN -->
          <div v-if="showTab === 'cholinkien'">
            <div v-if="choLinhKien.length > 0">
              <h5 class="mb-3">Chờ linh kiện ({{ choLinhKien.length }})</h5>
              <div class="case-strip">
                <div v-for="item in choLinhKien" :key="item.id" class="case-card" style="cursor: pointer;">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-warning d-flex flex-column">
                      <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                          <button @click.stop="dongCa(item)" class="btn btn-sm btn-success">Chốt ca</button>
                          <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                          <span v-if="item.warehouse" class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) }}</span>
                          <span class="badge bg-warning text-dark">Chờ linh kiện</span>
                        </div>
                        <button @click.stop="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">🗑️ Xóa</button>
                      </div>
                      <div class="info-content">
                        <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                        <div class="fw-bold text-secondary mb-1">📞 {{ item.phone }}</div>
                        <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                        <div class="small text-muted mb-2">📍 {{ item.address }}</div>
                        <div class="text-danger small fw-bold mb-2">⚠️ {{ item.issue }}</div>
                        <div class="text-info small fw-bold mb-3">🔧 Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                        <div class="input-group input-group-sm mb-3 mt-2">
                          <input :id="'single-drive-'+item.id" class="form-control" placeholder="Link ảnh lẻ..." @keyup.enter="addSingleDrive(item)">
                          <button @click="addSingleDrive(item)" class="btn btn-outline-primary">Thêm</button>
                        </div>
                        <div class="mt-auto">
                          <div v-if="!item.folderDrive || isEditingLink[item.id]" class="input-group input-group-sm">
                            <input v-model="tempFolderLink[item.id]" class="form-control" placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(item.id)">
                            <button @click="saveFolderLink(item.id)" class="btn btn-primary">Lưu</button>
                          </div>
                          <div v-else class="d-flex gap-1">
                            <a :href="item.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">📂 DRIVE TỔNG</a>
                            <button @click="startEditFolder(item.id, item.folderDrive)" class="btn btn-sm btn-light border">Sửa</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca chờ linh kiện cho loại này</div>
          </div>

          <!-- TAB HOÀN THÀNH -->
          <div v-if="showTab === 'hoanthanh'">
            <div v-if="Object.keys(hoanThanh).length > 0">
              <h5 class="mb-3">Hoàn thành</h5>
              <div v-for="(group, date) in hoanThanh" :key="date" class="mb-4">
                <div class="mb-3"><span class="date-pill">📅 {{ date }} ({{ group.length }} ca)</span></div>
                <div class="case-strip">
                  <div v-for="item in group" :key="item.id" class="case-card" @click="openDetailModal(item)" style="cursor: pointer;">
                    <div class="card border-0 shadow-sm">
                      <div class="card-body border-start border-5 border-success">
                        <div class="d-flex justify-content-between mb-2 flex-wrap gap-2">
                          <span class="fw-bold text-success">{{ item.ticketId }} - {{ item.name }}</span>
                          <span v-if="item.warehouse" class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) }}</span>
                          <button @click.stop="revertToDangLam(item)" class="btn btn-sm btn-warning">Hoàn lại chờ</button>
                        </div>
                        <div class="small text-muted">{{ item.phone }} | {{ item.model }} | Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca hoàn thành cho loại này</div>
          </div>
        </div>

        <!-- CA NGOÀI -->
        <div v-else-if="currentType === 'OUTSIDE'">
          <div v-if="filteredCustomers.length > 0">
            <h5 class="mb-3">Tất cả ca ngoài ({{ filteredCustomers.length }})</h5>
            <div class="case-strip">
              <div v-for="item in filteredCustomers" :key="item.id" class="case-card"
                @click="openOutsideDetailModal(item)" style="cursor: pointer;">
                <div class="card border-0 shadow-sm h-100">
                  <div class="card-body border-start border-5" :class="getStatusClass(item.status).border">
                    <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
                      <div class="d-flex align-items-center gap-2 flex-wrap">
                        <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                        <span :class="['badge', getStatusClass(item.status).badge]">{{ getStatusClass(item.status).label }}</span>
                      </div>
                      <button @click.stop="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">Xóa</button>
                    </div>
                    <div class="info-content">
                      <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                      <div class="fw-bold text-secondary mb-1">📞 {{ item.phone }}</div>
                      <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                      <div class="text-danger small fw-bold mb-2">⚠️ {{ item.issue }}</div>
                      <div class="text-info small fw-bold">🔧 Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-center text-muted py-5">Chưa có ca ngoài</div>
        </div>
      </section>

      <!-- MODAL NHẬN CA NGOÀI MỚI -->
      <div v-if="showOutsideForm" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title">Nhận Ca Ngoài Mới</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeOutsideForm"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label fw-bold">Tên khách hàng</label>
                <input v-model="outsideForm.name" type="text" class="form-control" placeholder="VD: Anh Hòa, Chị Mai...">
              </div>
              <div class="mb-3">
                <label class="form-label fw-bold">SĐT khách hàng</label>
                <input v-model="outsideForm.phone" type="tel" class="form-control" placeholder="VD: 0905123456">
              </div>
              <div class="mb-3">
                <label class="form-label fw-bold">Hãng TV</label>
                <input v-model="outsideForm.brand" type="text" class="form-control" placeholder="VD: Xiaomi, Samsung, LG">
              </div>
              <div class="mb-3">
                <label class="form-label fw-bold">Model TV</label>
                <input v-model="outsideForm.model" type="text" class="form-control" placeholder="VD: TV A2 2025">
              </div>
              <div class="mb-3">
                <label class="form-label fw-bold">Tình trạng / Lỗi TV</label>
                <textarea v-model="outsideForm.issue" class="form-control" rows="4" placeholder="VD: Màn hình đen..."></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeOutsideForm">Đóng</button>
              <button type="button" class="btn btn-success" @click="saveOutsideCa">Lưu Ca Ngoài</button>
            </div>
          </div>
        </div>
      </div>

      <!-- MODAL CHI TIẾT CA NGOÀI -->
      <div v-if="showOutsideDetailModal && selectedOutside" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.7);">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header text-white"
              :style="{ backgroundColor: selectedOutside.status === 0 ? '#3b82f6' : selectedOutside.status === 1 ? '#f59e0b' : '#198754' }">
              <h5 class="modal-title">
                {{ selectedOutside.ticketId }}
                <span class="badge ms-2 bg-white fw-bold"
                  :style="{ color: selectedOutside.status === 0 ? '#3b82f6' : selectedOutside.status === 1 ? '#f59e0b' : '#198754' }">
                  {{ selectedOutside.status === 0 ? 'Đang làm' : selectedOutside.status === 1 ? 'Chờ linh kiện' : 'Hoàn thành' }}
                </span>
              </h5>
              <button type="button" class="btn-close btn-close-white" @click="closeOutsideDetailModal"></button>
            </div>
            <div class="modal-body">
              <div class="row">
                <!-- Cột trái: thông tin + điều khiển -->
                <div class="col-md-5">
                  <h5 class="mb-1 fw-bold">{{ selectedOutside.name }}</h5>
                  <p class="text-secondary fw-bold mb-3">📞 {{ selectedOutside.phone }}</p>
                  <p><strong>Model:</strong> {{ selectedOutside.model }}</p>
                  <p><strong>Lỗi:</strong> <span class="text-danger fw-bold">{{ selectedOutside.issue }}</span></p>
                  <p><strong>Ngày tạo:</strong> {{ formatDate(selectedOutside.createdAt) }}</p>
                  <p v-if="selectedOutside.doneDate"><strong>Ngày hoàn thành:</strong> {{ selectedOutside.doneDate }}</p>

                  <!-- Đổi trạng thái -->
                  <div class="mt-3 mb-3">
                    <label class="form-label fw-bold">Chuyển trạng thái:</label>
                    <div class="d-flex gap-2 flex-wrap">
                      <button @click="changeOutsideStatus(0)"
                        :class="['btn fw-bold flex-grow-1', selectedOutside.status === 0 ? 'btn-primary' : 'btn-outline-primary']">
                        ⚡ Đang làm
                      </button>
                      <button @click="changeOutsideStatus(1)"
                        :class="['btn fw-bold flex-grow-1', selectedOutside.status === 1 ? 'btn-warning' : 'btn-outline-warning']">
                        ⏳ Chờ linh kiện
                      </button>
                      <button @click="changeOutsideStatus(2)"
                        :class="['btn fw-bold flex-grow-1', selectedOutside.status === 2 ? 'btn-success' : 'btn-outline-success']">
                        ✅ Hoàn thành
                      </button>
                    </div>
                  </div>

                  <!-- Linh kiện -->
                  <div class="mt-3">
                    <label class="form-label fw-bold">Linh kiện thay:</label>
                    <div class="input-group mb-1">
                      <input v-model="editingOutsidePart" type="text" class="form-control"
                        placeholder="Nhập linh kiện..." @keyup.enter="saveOutsidePart">
                      <button @click="saveOutsidePart" class="btn btn-success fw-bold">Lưu</button>
                    </div>
                    <small class="text-muted">Hiện tại: {{ selectedOutside.replacedPart || 'Chưa có' }}</small>
                  </div>

                  <!-- Drive -->
                  <div class="mt-3">
                    <label class="form-label fw-bold">Link Drive:</label>
                    <div v-if="!selectedOutside.folderDrive || isEditingLink[selectedOutside.id]" class="input-group input-group-sm">
                      <input v-model="tempFolderLink[selectedOutside.id]" class="form-control"
                        placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(selectedOutside.id)">
                      <button @click="saveFolderLink(selectedOutside.id)" class="btn btn-primary">Lưu</button>
                    </div>
                    <div v-else class="d-flex gap-2">
                      <a :href="selectedOutside.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">📂 MỞ DRIVE</a>
                      <button @click="startEditFolder(selectedOutside.id, selectedOutside.folderDrive)" class="btn btn-sm btn-light border">✏️ Sửa</button>
                    </div>
                  </div>
                </div>

                <!-- Cột phải: ảnh -->
                <div class="col-md-7">
                  <h6 class="mb-3">Ảnh & Video</h6>
                  <div v-if="!selectedOutside.media || selectedOutside.media.length === 0" class="text-muted small mb-3">
                    ⏳ Đang tải ảnh...
                  </div>
                  <div class="media-grid">
                    <div v-for="(m, idx) in selectedOutside.media || []" :key="idx" class="media-item position-relative">
                      <img v-if="m.type === 'image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh" style="cursor:pointer;">
                      <video v-else :src="m.data" controls preload="metadata"></video>
                      <span @click.stop="removeMedia(selectedOutside, idx)" class="media-del">×</span>
                    </div>
                    <label class="media-add">
                      <span>+</span>
                      <input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, selectedOutside)">
                    </label>
                  </div>
                  <div class="input-group input-group-sm mt-2">
                    <input :id="'single-drive-'+selectedOutside.id" class="form-control" placeholder="Link ảnh lẻ...">
                    <button @click="addSingleDrive(selectedOutside)" class="btn btn-outline-primary">Thêm</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button @click="deleteCustomer(selectedOutside.id)" class="btn btn-danger">🗑️ Xóa ca</button>
              <button type="button" class="btn btn-secondary" @click="closeOutsideDetailModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- MODAL CHI TIẾT HOÀN THÀNH ASVN/CSVN -->
      <div v-if="showDetailModal && selectedCustomer" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.7);">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title">Chi tiết ca: {{ selectedCustomer.ticketId }}</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeDetailModal"></button>
            </div>
            <div class="modal-body">
              <div class="row">
                <div class="col-md-5">
                  <h5 class="text-success mb-3">{{ selectedCustomer.name }} - {{ selectedCustomer.phone }}</h5>
                  <p><strong>Kho:</strong> {{ selectedCustomer.warehouse || 'N/A' }}</p>
                  <p v-if="selectedCustomer.serial"><strong>Serial:</strong> {{ selectedCustomer.serial }}</p>
                  <p v-if="selectedCustomer.branch"><strong>Chi nhánh:</strong> {{ selectedCustomer.branch }}</p>
                  <p><strong>Model:</strong> {{ selectedCustomer.model }}</p>
                  <p><strong>Địa chỉ:</strong> {{ selectedCustomer.address }}</p>
                  <p><strong>Lỗi:</strong> <span class="text-danger">{{ selectedCustomer.issue }}</span></p>
                  <p><strong>Linh kiện thay:</strong> {{ selectedCustomer.replacedPart || 'Chưa có' }}</p>
                  <p><strong>Ngày hoàn thành:</strong> {{ selectedCustomer.doneDate }}</p>
                  <p><strong>Ngày tạo:</strong> {{ formatDate(selectedCustomer.createdAt) }}</p>
                </div>
                <div class="col-md-7">
                  <h6 class="mb-3">Ảnh & Video</h6>
                  <div v-if="!selectedCustomer.media || selectedCustomer.media.length === 0" class="text-muted small mb-3">
                    ⏳ Đang tải ảnh...
                  </div>
                  <div class="media-grid">
                    <div v-for="(m, idx) in selectedCustomer.media || []" :key="idx" class="media-item position-relative">
                      <img v-if="m.type === 'image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh" style="cursor: pointer;">
                      <video v-else :src="m.data" controls preload="metadata" style="cursor: pointer;"></video>
                      <span @click.stop="removeMedia(selectedCustomer, idx)" class="media-del">×</span>
                    </div>
                    <label class="media-add">
                      <span>+</span>
                      <input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, selectedCustomer)">
                    </label>
                  </div>
                  <div class="mt-3">
                    <div v-if="!selectedCustomer.folderDrive || isEditingLink[selectedCustomer.id]" class="input-group input-group-sm">
                      <input v-model="tempFolderLink[selectedCustomer.id]" class="form-control"
                        placeholder="Dán link Google Drive..." @keyup.enter="saveFolderLink(selectedCustomer.id)">
                      <button @click="saveFolderLink(selectedCustomer.id)" class="btn btn-primary fw-bold">Lưu</button>
                    </div>
                    <div v-else class="d-flex gap-2">
                      <a :href="selectedCustomer.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">📂 MỞ DRIVE</a>
                      <button @click="startEditFolder(selectedCustomer.id, selectedCustomer.folderDrive)" class="btn btn-sm btn-light border fw-bold">✏️ Đổi link</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button @click="revertToDangLam(selectedCustomer)" class="btn btn-warning">Hoàn lại chờ xử lý</button>
              <button type="button" class="btn btn-secondary" @click="closeDetailModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- MODAL PHÓNG TO MEDIA -->
      <div v-if="showModal" class="media-modal-overlay" @click="closeMediaModal">
        <div class="media-modal-content" @click.stop>
          <button class="modal-close" @click="closeMediaModal">×</button>
          <img v-if="modalMedia?.type === 'image'" :src="modalMedia.data" alt="Ảnh phóng to" class="modal-media">
          <video v-else-if="modalMedia?.type === 'video'" :src="modalMedia.data" controls autoplay class="modal-media"></video>
        </div>
      </div>

      <!-- MODAL CHỌN LINH KIỆN -->
      <div v-if="showPartModal" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Chọn loại linh kiện thay</h5>
              <button type="button" class="btn-close" @click="closePartModal"></button>
            </div>
            <div class="modal-body">
              <div v-if="!showCustomInput" class="list-group">
                <button v-for="part in linhKienList" :key="part"
                  class="list-group-item list-group-item-action"
                  :class="{ 'list-group-item-warning fw-bold': part === 'Khác' }"
                  @click="selectPart(part)">
                  {{ part === 'Khác' ? '✏️ Khác (tự nhập)' : part }}
                </button>
              </div>
              <div v-else>
                <p class="text-muted mb-3">Nhập tên linh kiện thay thế:</p>
                <input v-model="customPartInput" type="text" class="form-control form-control-lg mb-3"
                  placeholder="VD: Thay loa, Thay remote..." @keyup.enter="confirmCustomPart" autofocus>
                <div class="d-flex gap-2">
                  <button @click="showCustomInput = false" class="btn btn-outline-secondary flex-grow-1">← Quay lại</button>
                  <button @click="confirmCustomPart" class="btn btn-success flex-grow-1 fw-bold">✅ Xác nhận</button>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closePartModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- MODAL CA TRỄ -->
      <div v-if="showTreModal" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
          <div class="modal-content">
            <div class="modal-header bg-warning text-dark">
              <h5 class="modal-title">Ca bị trễ ({{ treCaList.length }} ca)</h5>
              <button type="button" class="btn-close" @click="closeTreModal"></button>
            </div>
            <div class="modal-body p-3">
              <div v-if="treCaList.length === 0" class="text-center text-muted py-5">Không có ca nào bị trễ</div>
              <div v-else class="list-group">
                <button v-for="item in treCaList" :key="item.id"
                  class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-3"
                  @click="selectTreCa(item)">
                  <div class="flex-grow-1">
                    <div class="d-flex justify-content-between mb-1">
                      <strong class="text-primary fs-5">{{ item.ticketId }}</strong>
                      <small class="text-muted">{{ formatDate(item.createdAt) }}</small>
                    </div>
                    <div class="mb-1 fw-bold">{{ item.name }} - {{ item.phone }}</div>
                    <small class="text-danger d-block">{{ item.issue }}</small>
                  </div>
                  <span class="badge bg-danger text-white ms-3">Trễ</span>
                </button>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeTreModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- MODAL TÍNH HÀNH TRÌNH -->
      <div v-if="showRouteModal" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.7); overflow-y: auto;">
        <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-info text-white">
              <h5 class="modal-title">📍 Tính Hành Trình Thuận Tiện</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeRouteModal"></button>
            </div>
            <div class="modal-body">
              <div class="mb-4">
                <label class="form-label fw-bold">Địa chỉ hiện tại của bạn:</label>
                <div class="input-group">
                  <input v-model="currentLocation" type="text" class="form-control"
                    placeholder="VD: 123 Nguyễn Văn Linh, Thanh Khê, Đà Nẵng"
                    @keyup.enter="calculateRoute">
                  <button @click="calculateRoute" :disabled="isLoadingRoute" class="btn btn-info fw-bold">
                    {{ isLoadingRoute ? '⏳ Đang tính...' : '🚀 Tính tuyến đường' }}
                  </button>
                </div>
              </div>
              <div v-if="currentCoords" class="alert alert-success mb-4">
                ✅ Vị trí hiện tại: <strong>{{ currentCoords.displayName || `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}` }}</strong>
              </div>
              <div v-if="isLoadingRoute" class="text-center py-5">
                <div class="spinner-border text-info" role="status" style="width: 3rem; height: 3rem;"></div>
                <p class="mt-3 fw-bold">Đang tính toán khoảng cách...</p>
              </div>
              <div v-else-if="routeCustomers.length > 0">
                <h6 class="mb-3 fw-bold">Thứ tự gợi ý (gần nhất → xa nhất):</h6>
                <div class="list-group">
                  <button v-for="(item, idx) in routeCustomers" :key="item.id"
                    class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-3"
                    @click="searchQuery = item.ticketId; closeRouteModal()"
                    :class="{ 'list-group-item-warning': item.distance === 'N/A' }">
                    <div class="flex-grow-1">
                      <div class="d-flex align-items-center gap-3 mb-2">
                        <span class="badge bg-primary rounded-pill fs-5 px-3 py-2">{{ idx + 1 }}</span>
                        <div>
                          <strong>{{ item.ticketId }} - {{ item.name }}</strong>
                          <span v-if="item.distance !== 'N/A'" class="badge bg-warning ms-2">{{ item.distance }} km</span>
                          <span v-else class="badge bg-secondary ms-2">Không xác định</span>
                        </div>
                      </div>
                      <div class="mb-1"><strong>📞</strong> {{ item.phone }}</div>
                      <div class="mb-1"><strong>📍</strong> {{ item.displayAddress }}</div>
                      <small class="text-danger fw-bold">⚠️ {{ item.issue }}</small>
                    </div>
                  </button>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeRouteModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.btn-sm.text-danger { color: #dc3545 !important; }
.btn-sm.text-danger:hover { color: #b02a37 !important; }
.page-wrap { min-height: 100vh; padding: 2rem 1rem; background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); font-family: system-ui, -apple-system, sans-serif; }
.layout { max-width: 1450px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; width: 100%; }
.control-card, .cases-section { background: white; border-radius: 20px; padding: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; width: 100%; }
.toggle-row, .status-toggle-row, .warehouse-toggle-row { display: flex; gap: 0.75rem; margin-bottom: 1rem; }
.toggle-row button, .status-toggle-row button { flex: 1; padding: 0.875rem 1rem; border-radius: 12px; font-size: 1rem; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
.toggle-row button:hover, .status-toggle-row button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
.warehouse-toggle-row { align-items: center; }
.gear-container { flex-shrink: 0; margin-right: 0.5rem; }
.btn-gear { width: 40px; height: 40px; border-radius: 50%; background: #f3f4f6; border: 1px solid #d1d5db; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; cursor: pointer; transition: all 0.2s ease; }
.btn-gear:hover { background: #e5e7eb; transform: scale(1.05); }
.warehouse-buttons { flex: 1; display: flex; gap: 0.5rem; }
.warehouse-buttons button { flex: 1; padding: 0.75rem 1rem; border-radius: 10px; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.08); }
.warehouse-buttons button:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.12); }
.control-body { background: #f8f9fa; border-radius: 12px; padding: 1.25rem; border: 1px solid #e5e7eb; }
.control-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; margin-top: 1rem; }
.control-actions input { grid-column: span 3; padding: 0.875rem; font-size: 1rem; }
.section-header { margin-bottom: 1.5rem; text-align: center; }
.section-title { font-weight: 800; color: #1e293b; font-size: 1.6rem; margin: 0; letter-spacing: -0.025em; }
.case-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem; width: 100%; }
.case-card { animation: fadeIn 0.4s ease-out; transition: all 0.3s ease; border-radius: 16px; overflow: hidden; background: white; }
.case-card:hover { transform: translateY(-4px); box-shadow: 0 10px 25px rgba(0,0,0,0.1) !important; }
.card { transition: all 0.3s ease; border: 1px solid #e2e8f0 !important; border-radius: 16px; height: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.card-body { padding: 1.5rem; display: flex; flex-direction: column; }
.border-primary { border-left-color: #3b82f6 !important; }
.border-warning { border-left-color: #f59e0b !important; }
.border-success { border-left-color: #10b981 !important; }
.info-content { flex: 1; display: flex; flex-direction: column; gap: 0.75rem; font-size: 1rem; }
.info-content .fw-bold { font-size: 1.1rem; line-height: 1.3; }
.text-danger { color: #ef4444 !important; }
.text-info { color: #0ea5e9 !important; }
.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 0.75rem; margin: 1rem 0; }
.media-item { position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.08); }
.media-item img, .media-item video { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; cursor: pointer; transition: transform 0.2s ease; }
.media-item:hover img, .media-item:hover video { transform: scale(1.05); }
.media-del { position: absolute; top: -6px; right: -6px; background: #ef4444; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 12px; cursor: pointer; z-index: 10; font-weight: bold; }
.media-add { aspect-ratio: 1; border: 2px dashed #cbd5e0; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #94a3b8; font-size: 24px; transition: all 0.2s ease; }
.media-add:hover { border-color: #3b82f6; background: #eff6ff; color: #3b82f6; }
.date-pill { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 0.5rem 1rem; border-radius: 20px; font-weight: 600; font-size: 0.9rem; box-shadow: 0 2px 4px rgba(16,185,129,0.3); }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.media-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; z-index: 1000; cursor: pointer; }
.media-modal-content { position: relative; max-width: 95vw; max-height: 95vh; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
.modal-media { max-width: 100%; max-height: 95vh; object-fit: contain; display: block; }
.modal-close { position: absolute; top: 15px; right: 15px; background: rgba(0,0,0,0.5); color: white; border: none; font-size: 28px; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; z-index: 10; }
.modal-close:hover { background: rgba(255,0,0,0.8); }
.modal-xl { max-width: 1100px; }
.modal-header.bg-success { background-color: #198754 !important; }
.modal-header.bg-info { background-color: #17a2b8 !important; }
.modal-header.bg-warning { background-color: #ffc107 !important; color: #000 !important; }
.btn-close-white { filter: invert(1); }
.btn-info { background-color: #17a2b8; border-color: #17a2b8; }
.list-group-item-action:hover { background-color: #f8f9fa; }
.list-group-item-warning { background-color: #fff3cd !important; border-left: 5px solid #ffc107 !important; }
@media (min-width: 769px) and (max-width: 1023px) {
  .case-strip { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .control-actions { grid-template-columns: 1fr 1fr; }
  .control-actions input { grid-column: span 2; }
  .toggle-row, .status-toggle-row, .warehouse-toggle-row { gap: 0.5rem; }
  .section-title { font-size: 1.4rem; }
}
@media (max-width: 768px) {
  .page-wrap { padding: 1rem 0.5rem; }
  .layout { gap: 1rem; max-width: 100%; }
  .control-card, .cases-section { padding: 1rem; border-radius: 16px; }
  .toggle-row, .status-toggle-row { flex-direction: column; gap: 0.75rem; }
  .toggle-row button, .status-toggle-row button { flex: none; width: 100%; padding: 1rem; min-height: 50px; justify-content: flex-start; }
  .warehouse-toggle-row { flex-direction: column; align-items: stretch; gap: 0.75rem; }
  .gear-container { align-self: flex-start; margin: 0; }
  .btn-gear { width: 50px; height: 50px; font-size: 1.5rem; }
  .warehouse-buttons { flex-direction: column; gap: 0.5rem; width: 100%; }
  .warehouse-buttons button { width: 100%; padding: 1rem; min-height: 50px; }
  .control-body { padding: 1rem; }
  .control-actions { grid-template-columns: 1fr; gap: 0.75rem; }
  .control-actions input { grid-column: span 1; font-size: 1rem; padding: 0.875rem; }
  .case-strip { grid-template-columns: 1fr; gap: 1.25rem; }
  .card-body { padding: 1.25rem; }
  .section-title { font-size: 1.25rem; }
}
@media (max-width: 480px) {
  .modal-dialog { margin: 0.5rem; max-width: calc(100% - 1rem); }
  .modal-content { border-radius: 12px; }
  .media-modal-content { max-width: 100vw; max-height: 100vh; border-radius: 0; }
  .modal-close { font-size: 24px; width: 36px; height: 36px; }
}
@media (min-width: 1200px) {
  .case-strip { grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); }
  .control-actions { grid-template-columns: 1fr 1fr 1fr; }
}
</style>