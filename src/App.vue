<script setup>
import { ref, computed, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import { getSupabase } from './lib/supabase'

// Composable (giả định export đúng; nếu lỗi, comment và dùng mock dưới)
import { useSupabaseCustomers } from '@/composables/useSupabaseCustomers'
import { useTicketParser } from '@/composables/useTicketParser'
import { useGeocodingAndRouting } from '@/composables/useGeocodingAndRouting'
import { useLinhKienManager } from '@/composables/useLinhKienManager'

// === SUPABASE & CUSTOMERS ===
const searchQuery = ref('')
const historySearchQuery = ref('') // Thêm cho tab hoàn thành
const { customers, loadData, isLoading } = useSupabaseCustomers()
const supabase = getSupabase()

// Mock data nếu composables lỗi (thêm ca test như ảnh)
if (isLoading.value === undefined) { // Nếu composables chưa ready
  customers.value = [
    { id: 1, ticketId: 'ASVN001', name: 'Nguyễn Văn A', phone: '0905123456', model: 'Xiaomi TV A2', address: '123 Nguyễn Văn Linh, Thanh Khê', issue: 'Màn hình đen', status: 0, media: [], replacedPart: 'Chưa có', createdAt: new Date().toISOString() }
  ]
  loadData = async () => { /* Mock load */ }
}

// === TICKET PARSER ===
const { rawInput, handleParse } = useTicketParser(loadData)

// === ROUTING ===
const routing = useGeocodingAndRouting({ value: customers })
const {
  currentLocation,
  currentCoords,
  showRouteModal,
  routeCustomers,
  isLoadingRoute,
  openRouteModal,
  closeRouteModal,
  calculateRoute
} = routing

// === LINH KIỆN MANAGER ===
const linhKien = useLinhKienManager(loadData)
const {
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
} = linhKien

// === 3 LOẠI CA (TỪ CODE 1) ===
const currentType = ref('ASVN')
const isEditingLink = ref({})
const tempFolderLink = ref({})

// === 3 TRẠNG THÁI (TỪ CODE 2 - THÊM NÚT SWITCH) ===
const showTab = ref('danglam') // 'danglam' / 'cholinkien' / 'hoanthanh'

// Modal vars
const showDetailModal = ref(false)
const selectedCustomer = ref(null)
const showModal = ref(false)
const modalMedia = ref(null)
const showTreModal = ref(false)
const openTreModal = () => showTreModal.value = true
const closeTreModal = () => showTreModal.value = false
const openMediaModal = (media) => { modalMedia.value = media; showModal.value = true; document.body.style.overflow = 'hidden'; }
const closeMediaModal = () => { showModal.value = false; modalMedia.value = null; document.body.style.overflow = ''; }
const openDetailModal = (customer) => { selectedCustomer.value = { ...customer }; showDetailModal.value = true; document.body.style.overflow = 'hidden'; }
const closeDetailModal = () => { showDetailModal.value = false; selectedCustomer.value = null; document.body.style.overflow = ''; }
const selectCaToEdit = (item) => { console.log('Edit:', item); /* Linh kiện edit */ }

// === COMPUTED: Filter loại ca + trạng thái ===
const filteredCustomers = computed(() => {
  let filtered = customers.value

  if (currentType.value === 'ASVN') filtered = filtered.filter(c => c.ticketId?.startsWith('ASVN'))
  else if (currentType.value === 'CSVN') filtered = filtered.filter(c => c.ticketId?.startsWith('CSVN'))
  else if (currentType.value === 'OUTSIDE') filtered = filtered.filter(c => c.ticketId?.startsWith('NGOAI'))

  const q = searchQuery.value.toLowerCase()
  return filtered.filter(c => 
    c.name?.toLowerCase().includes(q) ||
    c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) ||
    c.model?.toLowerCase().includes(q) ||  // Thêm tìm theo model
    c.replacedPart?.toLowerCase().includes(q)  // Thêm tìm theo linh kiện
  )
})

const dangLam = computed(() => filteredCustomers.value.filter(c => c.status === 0))
const choLinhKien = computed(() => {
  // Filter nghiêm ngặt hơn cho linh kiện/model nếu searchQuery chỉ là linh kiện/model (nhưng giữ đơn giản: include nếu match)
  const q = searchQuery.value.toLowerCase()
  return filteredCustomers.value.filter(c => c.status === 1 && (
    c.name?.toLowerCase().includes(q) ||
    c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) ||
    c.model?.toLowerCase().includes(q) ||
    c.replacedPart?.toLowerCase().includes(q)
  ))
})
const hoanThanh = computed(() => {
  // Sử dụng historySearchQuery riêng cho tab hoàn thành, và filter theo model/linh kiện
  const q = historySearchQuery.value.toLowerCase()
  const items = filteredCustomers.value.filter(c => c.status === 2 && (
    c.name?.toLowerCase().includes(q) ||
    c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) ||
    c.model?.toLowerCase().includes(q) ||
    c.replacedPart?.toLowerCase().includes(q)
  ))
  const groups = {}
  items.forEach(item => {
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

// === FORM CA NGOÀI ===
const showOutsideForm = ref(false)
const outsideForm = ref({ phone: '', brand: '', model: '', issue: '' })

const openOutsideForm = () => { showOutsideForm.value = true; outsideForm.value = { phone: '', brand: '', model: '', issue: '' }; }
const closeOutsideForm = () => showOutsideForm.value = false

const saveOutsideCa = async () => {
  if (!outsideForm.value.phone || !outsideForm.value.issue) { alert('Vui lòng nhập SĐT và tình trạng TV!'); return; }

  const now = new Date()
  const ticketId = `NGOAI-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`

  const newCa = {
    ticketId, name: 'Khách ngoài', phone: outsideForm.value.phone, model: `${outsideForm.value.brand} ${outsideForm.value.model}`.trim() || 'Chưa rõ',
    address: 'Ca ngoài - không có địa chỉ', issue: outsideForm.value.issue, media: [], folderDrive: '', status: 0,
    replacedPart: 'Chưa có linh kiện thay', doneDate: null, createdAt: now.toISOString()
  }

  const { error } = await supabase.from('customers').insert([newCa])
  if (error) { alert('Lỗi lưu ca ngoài: ' + error.message); return; }

  alert('Đã nhận ca ngoài thành công! Mã: ' + ticketId)
  closeOutsideForm()
  loadData()
}

// === CA TRỄ FUNCTION ===
const selectTreCa = (item) => {
  searchQuery.value = item.ticketId
  closeTreModal()
}

// === ON MOUNTED ===
onMounted(() => {
  loadData()
  const channel = new BroadcastChannel('zalo_bridge')
  channel.onmessage = (event) => { if (event.data) handleParse(event.data); }

  window.addEventListener('focus', async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && (text.includes("ASVN") || text.includes("CSVN"))) handleParse(text)
    } catch (err) {}
  })
})

// Các function khác (media, trạng thái, folder, export - giữ nguyên)
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
  const currentMedia = item.media || []
  for (const file of files) {
    const reader = new FileReader()
    const base64 = await new Promise(r => { reader.onload = () => r(reader.result); reader.readAsDataURL(file); })
    currentMedia.push({ type: file.type.startsWith('video') ? 'video' : 'image', data: base64, source: 'local' })
  }
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  loadData()
}

const addSingleDrive = async (item) => {
  const inputEl = document.getElementById(`single-drive-${item.id}`)
  if (!inputEl || !inputEl.value.trim()) return
  const currentMedia = item.media || []
  const link = inputEl.value.trim()
  currentMedia.push({ type: 'image', data: formatDriveLink(link), source: 'drive', original: link })
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  inputEl.value = ''
  loadData()
}

const removeMedia = async (item, index) => {
  const updatedMedia = [...item.media]
  updatedMedia.splice(index, 1)
  await supabase.from('customers').update({ media: updatedMedia }).eq('id', item.id)
  loadData()
}

const hoanTatKiemTra = async (item) => {
  await supabase.from('customers').update({ status: 1 }).eq('id', item.id)
  await loadData()
}

const dongCa = async (item) => {
  const now = new Date()
  const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth()+1).toString().padStart(2, '0')}/${now.getFullYear()}`
  await supabase.from('customers').update({ status: 2, doneDate: dateStr }).eq('id', item.id)
  await loadData()
}

const revertToDangLam = async (item) => {
  await supabase.from('customers').update({ status: 0, doneDate: null }).eq('id', item.id)
  await loadData()
  if (showDetailModal.value) closeDetailModal()
}

const deleteCustomer = async (id) => {
  if (confirm("Bạn có chắc chắn muốn xóa ca này?")) {
    await supabase.from('customers').delete().eq('id', id)
    await loadData()
    if (showDetailModal.value) closeDetailModal()
  }
}

const startEditFolder = (id, currentLink) => {
  isEditingLink.value[id] = true
  tempFolderLink.value[id] = currentLink || ''
}

const saveFolderLink = async (id) => {
  const link = tempFolderLink.value[id]
  await supabase.from('customers').update({ folderDrive: link }).eq('id', id)
  isEditingLink.value[id] = false
  // Sync ngay vào selectedCustomer nếu modal đang mở
  if (showDetailModal.value && selectedCustomer.value?.id === id) {
    selectedCustomer.value.folderDrive = link
  }
  await loadData()
}

const formatDate = (dateStr) => {
  if (!dateStr) return 'Chưa có ngày tạo'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return 'Ngày không hợp lệ'
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const exportToExcel = (data, fileName) => {
  if (!data.length) return alert("Không có dữ liệu!")
  const excelData = data.map(item => ({ 
    "Mã Ca": item.ticketId, "Ngày Hoàn thành": item.doneDate, "Khách Hàng": item.name, "SĐT": item.phone, 
    "Model": item.model, "Địa Chỉ": item.address, "Lỗi": item.issue, "Linh kiện thay": item.replacedPart 
  }))
  const ws = XLSX.utils.json_to_sheet(excelData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Báo Cáo")
  XLSX.writeFile(wb, `${fileName}.xlsx`)
}

const exportAllHoanThanh = () => exportToExcel(customers.value.filter(c => c.status === 2), 'Bao-Cao-Hoan-Thanh')

// Helper để lấy class border và badge cho status (dùng cho OUTSIDE)
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
        <!-- 3 NÚT PHÂN LOẠI LOẠI CA (ASVN/CSVN/CA NGOÀI - TỪ CODE 1, GIỐNG ẢNH BẠN GỬI) -->
        <div class="toggle-row">
          <button 
            @click="currentType = 'ASVN'; showTab = 'danglam'" 
            :class="['btn fw-bold flex-grow-1', currentType === 'ASVN' ? 'btn-primary text-white' : 'btn-outline-primary']">
            📋 ASVN
          </button>
          <button 
            @click="currentType = 'CSVN'; showTab = 'danglam'" 
            :class="['btn fw-bold flex-grow-1', currentType === 'CSVN' ? 'btn-primary text-white' : 'btn-outline-primary']">
            📋 CSVN
          </button>
          <button 
            @click="currentType = 'OUTSIDE'; showTab = 'danglam'" 
            :class="['btn fw-bold flex-grow-1', currentType === 'OUTSIDE' ? 'btn-primary text-white' : 'btn-outline-primary']">
            📝 Ca Ngoài
          </button>
        </div>

        <!-- 3 NÚT SWITCH TRẠNG THÁI (ĐANG LÀM/CHỜ LINH KIỆN/HOÀN THÀNH - TỪ CODE 2, CHỈ HIỆN CHO ASVN/CSVN) -->
        <div v-if="currentType !== 'OUTSIDE'" class="status-toggle-row">
          <button @click="showTab = 'danglam'" :class="['btn fw-bold flex-grow-1', showTab === 'danglam' ? 'btn-primary text-white' : 'btn-outline-primary']">⚡ ĐANG LÀM ({{ dangLam.length }})</button>
          <button @click="showTab = 'cholinkien'" :class="['btn fw-bold flex-grow-1', showTab === 'cholinkien' ? 'btn-warning text-white' : 'btn-outline-warning']">⏳ CHỜ LINH KIỆN ({{ choLinhKien.length }})</button>
          <button @click="showTab = 'hoanthanh'" :class="['btn fw-bold flex-grow-1', showTab === 'hoanthanh' ? 'btn-success text-white' : 'btn-outline-success']">✅ HOÀN THÀNH ({{ Object.values(hoanThanh).flat().length }})</button>
        </div>

        <!-- Control body theo loại ca và tab -->
        <div v-if="currentType === 'ASVN' || currentType === 'CSVN'">
          <div v-if="showTab === 'danglam'" class="control-body">
            <div class="d-flex justify-content-between align-items-start mb-3">
              <textarea v-model="rawInput" rows="2" class="form-control flex-grow-1 me-3" placeholder="Dán nội dung hoặc đợi tin nhắn Zalo..." @keyup.enter="handleParse()"></textarea>
              <div class="position-relative" style="min-width: 50px;">
                <button class="btn btn-outline-warning position-relative rounded-circle p-2 shadow" style="width: 50px; height: 50px; display: flex; align-items: center; justify-content: center;" @click="openTreModal" title="Thông báo ca trễ">
                  <span style="font-size: 1.8rem;">🔔</span>
                  <span v-if="treCaList.length > 0" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger border border-white" style="font-size: 0.75rem; min-width: 20px; height: 20px; line-height: 1.2; padding: 0;">
                    {{ treCaList.length }}
                  </span>
                </button>
              </div>
            </div>
            <div class="control-actions">
              <button @click="handleParse()" class="btn btn-primary fw-bold">NHẬP KHÁCH</button>
              <button @click="openRouteModal" class="btn btn-info fw-bold">🗺️ TÍNH HÀNH TRÌNH</button>
              <input type="text" v-model="searchQuery" class="form-control" placeholder="🔍 Tìm kiếm nhanh...">
            </div>
          </div>

          <!-- Control cho tab CHỜ LINH KIỆN (từ attachment 1 + composable linhKien) -->
          <div v-else-if="showTab === 'cholinkien'" class="control-body">
            <div class="d-flex flex-column gap-3">
              <!-- Tìm mã ASVN -->
              <div class="d-flex gap-3 flex-wrap align-items-end">
                <input v-model="searchTicketId" type="text" class="form-control flex-grow-1" placeholder="Nhập mã ASVN cần cập nhật/sửa linh kiện..." @keyup.enter="loadPartForEdit">
                <button @click="loadPartForEdit" class="btn btn-outline-primary">Tìm</button>
              </div>

              <!-- Nhập linh kiện -->
              <div class="d-flex gap-3 flex-wrap align-items-end">
                <input 
                  v-model="newReplacedPart" 
                  type="text" 
                  class="form-control flex-grow-1" 
                  :placeholder="editingPart ? 'Sửa linh kiện hiện tại...' : 'Loại linh kiện thay (ví dụ: Mainboard, Màn hình)...'"
                  @click="openPartModal"
                >
                <button @click="saveLinhKien" class="btn btn-success px-4 fw-bold">
                  {{ editingPart ? 'Sửa linh kiện' : 'Lưu linh kiện' }}
                </button>
                <button v-if="editingPart" @click="deleteLinhKien" class="btn btn-danger px-4 fw-bold">Xóa linh kiện</button>
              </div>

              <!-- Tìm kiếm chung -->
              <input v-model="searchQuery" type="text" class="form-control" placeholder="Tìm theo tên, sđt, mã ca, model TV, linh kiện...">
            </div>
          </div>

          <!-- Control cho tab HOÀN THÀNH (từ attachment 2) -->
          <div v-else-if="showTab === 'hoanthanh'" class="control-body">
            <div class="d-flex gap-2">
              <input type="text" v-model="historySearchQuery" class="form-control flex-grow-1" placeholder="🔍 Tìm trong lịch sử hoàn thành (tên, sđt, mã, model, linh kiện)...">
              <button @click="exportAllHoanThanh" class="btn btn-outline-dark fw-bold">📊 XUẤT EXCEL</button>
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
          </h2>
        </div>

        <!-- Sections theo showTab (CHỈ CHO ASVN/CSVN) -->
        <div v-if="currentType !== 'OUTSIDE'">
          <div v-if="showTab === 'danglam'">
            <div v-if="dangLam.length > 0">
              <h5 class="mb-3">Đang làm ({{ dangLam.length }})</h5>
              <div class="case-strip">
                <div v-for="item in dangLam" :key="item.id" class="case-card">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-primary d-flex flex-column">
                      <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="d-flex align-items-center gap-2">
                          <input type="checkbox" @change="hoanTatKiemTra(item)" style="width: 20px; height: 20px;">
                          <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                          <span class="badge bg-secondary">Chờ xử lý</span>
                        </div>
                        <button @click="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">Xóa</button>
                      </div>
                      <div class="info-content">
                        <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                        <div class="fw-bold text-secondary mb-1">📞 {{ item.phone }}</div>
                        <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                        <div class="small text-muted mb-2">📍 {{ item.address }}</div>
                        <div class="text-danger small fw-bold mb-2">⚠️ {{ item.issue }}</div>
                        <div class="text-info small fw-bold mb-3">🔧 Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>

                        <div class="media-grid">
                          <div v-for="(m, idx) in item.media" :key="idx" class="media-item">
                            <img v-if="m.type === 'image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh">
                            <video v-else :src="m.data" controls @click="openMediaModal(m)" preload="metadata"></video>
                            <span @click.stop="removeMedia(item, idx)" class="media-del">×</span>
                          </div>
                          <label class="media-add"><span>+</span><input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, item)"></label>
                        </div>

                        <!--<div class="input-group input-group-sm mb-3 mt-2">
                          <input :id="'single-drive-'+item.id" class="form-control" placeholder="Link ảnh lẻ..." @keyup.enter="addSingleDrive(item)">
                          <button @click="addSingleDrive(item)" class="btn btn-outline-primary">Thêm</button>
                        </div>

                        <!-- SỬA LINK DRIVE: Fix condition để show input khi edit hoặc chưa có -->
                        <div class="mt-auto">
                          <div v-if="!item.folderDrive || isEditingLink[item.id]" class="input-group input-group-sm">
                            <input v-model="tempFolderLink[item.id]" class="form-control" placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(item.id)">
                            <button @click="saveFolderLink(item.id)" class="btn btn-primary">Lưu</button>
                          </div>
                          <div v-else-if="item.folderDrive && !isEditingLink[item.id]" class="d-flex gap-1">
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

          <div v-if="showTab === 'cholinkien'">
            <div v-if="choLinhKien.length > 0">
              <h5 class="mb-3">Chờ linh kiện ({{ choLinhKien.length }})</h5>
              <div class="case-strip">
                <div v-for="item in choLinhKien" :key="item.id" class="case-card" @click="selectCaToEdit(item)" style="cursor: pointer;">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-warning d-flex flex-column">
                      <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                          <button @click.stop="dongCa(item)" class="btn btn-sm btn-success">Chốt ca</button>
                          <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                          <span class="badge bg-warning text-dark">Chờ linh kiện</span>
                        </div>
                        <button @click.stop="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">Xóa</button>
                      </div>
                      <div class="info-content">
                        <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                        <div class="fw-bold text-secondary mb-1">📞 {{ item.phone }}</div>
                        <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                        <div class="small text-muted mb-2">📍 {{ item.address }}</div>
                        <div class="text-danger small fw-bold mb-2">⚠️ {{ item.issue }}</div>
                        <div class="text-info small fw-bold mb-3">🔧 Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>

                        <div class="media-grid">
                          <div v-for="(m, idx) in item.media" :key="idx" class="media-item">
                            <img v-if="m.type === 'image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh">
                            <video v-else :src="m.data" controls @click="openMediaModal(m)" preload="metadata"></video>
                            <span @click.stop="removeMedia(item, idx)" class="media-del">×</span>
                          </div>
                          <label class="media-add"><span>+</span><input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, item)"></label>
                        </div>

                        <div class="input-group input-group-sm mb-3 mt-2">
                          <input :id="'single-drive-'+item.id" class="form-control" placeholder="Link ảnh lẻ..." @keyup.enter="addSingleDrive(item)">
                          <button @click="addSingleDrive(item)" class="btn btn-outline-primary">Thêm</button>
                        </div>

                        <!-- SỬA LINK DRIVE: Fix condition tương tự -->
                        <div class="mt-auto">
                          <div v-if="!item.folderDrive || isEditingLink[item.id]" class="input-group input-group-sm">
                            <input v-model="tempFolderLink[item.id]" class="form-control" placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(item.id)">
                            <button @click="saveFolderLink(item.id)" class="btn btn-primary">Lưu</button>
                          </div>
                          <div v-else-if="item.folderDrive && !isEditingLink[item.id]" class="d-flex gap-1">
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

          <div v-if="showTab === 'hoanthanh'">
            <div v-if="Object.keys(hoanThanh).length > 0">
              <h5 class="mb-3">Hoàn thành</h5>
              <div v-for="(group, date) in hoanThanh" :key="date" class="mb-4">
                <div class="mb-3"><span class="date-pill">📅 {{ date }} ({{ group.length }} ca)</span></div>
                <div class="case-strip">
                  <div v-for="item in group" :key="item.id" class="case-card" @click="openDetailModal(item)" style="cursor: pointer;">
                    <div class="card border-0 shadow-sm">
                      <div class="card-body border-start border-5 border-success">
                        <div class="d-flex justify-content-between mb-2">
                          <span class="fw-bold text-success">{{ item.ticketId }} - {{ item.name }}</span>
                          <button @click.stop="revertToDangLam(item)" class="btn btn-sm btn-warning">Hoàn lại chờ</button>
                        </div>
                        <div class="small text-muted mb-2">{{ item.phone }} | {{ item.model }} | Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                        <div v-if="item.media && item.media.length" class="media-grid-mini">
                          <div v-for="(m, idx) in item.media" :key="idx" class="media-item-mini">
                            <img v-if="m.type === 'image'" :src="m.data" @click.stop="openMediaModal(m)" alt="Ảnh nhỏ">
                            <video v-else :src="m.data" controls @click.stop="openMediaModal(m)" preload="metadata" style="width:100%; height:100%; object-fit:cover;"></video>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca hoàn thành cho loại này</div>
          </div>
        </div>

        <!-- PHẦN RIÊNG CHO CA NGOÀI: HIỂN THỊ TẤT CẢ TRẠNG THÁI TRONG MỘT GRID (KHÔNG CÓ TAB) -->
        <div v-else-if="currentType === 'OUTSIDE'">
          <div v-if="filteredCustomers.length > 0">
            <h5 class="mb-3">Tất cả ca ngoài ({{ filteredCustomers.length }})</h5>
            <div class="case-strip">
              <div v-for="item in filteredCustomers" :key="item.id" class="case-card" style="cursor: pointer;">
                <div class="card border-0 shadow-sm h-100">
                  <div class="card-body border-start border-5" :class="getStatusClass(item.status).border">
                    <!-- Header với actions theo status -->
                    <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
                      <div class="d-flex align-items-center gap-2 flex-wrap">
                        <span v-if="item.status === 0" class="fw-bold text-primary">{{ item.ticketId }}</span>
                        <span v-else-if="item.status === 1">
                          <button @click.stop="dongCa(item)" class="btn btn-sm btn-success">Chốt ca</button>
                          <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                        </span>
                        <span v-else-if="item.status === 2">
                          <span class="fw-bold text-success">{{ item.ticketId }} - {{ item.name }}</span>
                          <button @click.stop="revertToDangLam(item)" class="btn btn-sm btn-warning">Hoàn lại chờ</button>
                        </span>
                        <span :class="['badge', getStatusClass(item.status).badge]">{{ getStatusClass(item.status).label }}</span>
                      </div>
                      <button @click.stop="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">Xóa</button>
                    </div>

                    <!-- Nội dung chung -->
                    <div class="info-content">
                      <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                      <div class="fw-bold text-secondary mb-1">📞 {{ item.phone }}</div>
                      <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                      <div class="small text-muted mb-2">📍 {{ item.address }}</div>
                      <div class="text-danger small fw-bold mb-2">⚠️ {{ item.issue }}</div>
                      <div class="text-info small fw-bold mb-3">🔧 Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>

                      <!-- Checkbox chỉ cho status 0 -->
                      <div v-if="item.status === 0" class="mb-2">
                        <input type="checkbox" @change="hoanTatKiemTra(item)" style="width: 20px; height: 20px;">
                      </div>

                      <!-- Media -->
                      <div class="media-grid">
                        <div v-for="(m, idx) in item.media" :key="idx" class="media-item">
                          <img v-if="m.type === 'image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh">
                          <video v-else :src="m.data" controls @click="openMediaModal(m)" preload="metadata"></video>
                          <span @click.stop="removeMedia(item, idx)" class="media-del">×</span>
                        </div>
                        <label class="media-add"><span>+</span><input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, item)"></label>
                      </div>

                      <div class="input-group input-group-sm mb-3 mt-2">
                        <input :id="'single-drive-'+item.id" class="form-control" placeholder="Link ảnh lẻ..." @keyup.enter="addSingleDrive(item)">
                        <button @click="addSingleDrive(item)" class="btn btn-outline-primary">Thêm</button>
                      </div>

                      <!-- SỬA LINK DRIVE: Fix condition tương tự cho OUTSIDE -->
                      <div class="mt-auto">
                        <div v-if="!item.folderDrive || isEditingLink[item.id]" class="input-group input-group-sm">
                          <input v-model="tempFolderLink[item.id]" class="form-control" placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(item.id)">
                          <button @click="saveFolderLink(item.id)" class="btn btn-primary">Lưu</button>
                        </div>
                        <div v-else-if="item.folderDrive && !isEditingLink[item.id]" class="d-flex gap-1">
                          <a :href="item.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">📂 DRIVE TỔNG</a>
                          <button @click="startEditFolder(item.id, item.folderDrive)" class="btn btn-sm btn-light border">Sửa</button>
                        </div>
                      </div>
                    </div>

                    <!-- Mini media cho status 2 (nếu cần, nhưng giữ đơn giản) -->
                    <div v-if="item.status === 2 && item.media && item.media.length" class="media-grid-mini mt-2">
                      <div v-for="(m, idx) in item.media" :key="idx" class="media-item-mini">
                        <img v-if="m.type === 'image'" :src="m.data" @click.stop="openMediaModal(m)" alt="Ảnh nhỏ">
                        <video v-else :src="m.data" controls @click.stop="openMediaModal(m)" preload="metadata" style="width:100%; height:100%; object-fit:cover;"></video>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-center text-muted py-5">Chưa có ca ngoài</div>
        </div>
      </section>

      <!-- Các modal (giữ nguyên từ code 1 + 2) -->
      <!-- Modal Ca Ngoài -->
      <div v-if="showOutsideForm" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title">Nhận Ca Ngoài Mới</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeOutsideForm"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label fw-bold">SĐT khách hàng</label>
                <input v-model="outsideForm.phone" type="tel" class="form-control" placeholder="VD: 0905123456" required>
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
                <textarea v-model="outsideForm.issue" class="form-control" rows="4" placeholder="VD: Màn hình đen, không lên nguồn..."></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeOutsideForm">Đóng</button>
              <button type="button" class="btn btn-success" @click="saveOutsideCa">Lưu Ca Ngoài</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal chi tiết ca hoàn thành (từ code cũ, đắp vào) -->
      <div v-if="showDetailModal && selectedCustomer" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.7);">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title">Chi tiết ca hoàn thành: {{ selectedCustomer.ticketId }}</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeDetailModal"></button>
            </div>
            <div class="modal-body">
              <div class="row">
                <div class="col-md-5">
                  <h5 class="text-success mb-3">{{ selectedCustomer.name }} - {{ selectedCustomer.phone }}</h5>
                  <p><strong>Model:</strong> {{ selectedCustomer.model }}</p>
                  <p><strong>Địa chỉ:</strong> {{ selectedCustomer.address }}</p>
                  <p><strong>Lỗi:</strong> <span class="text-danger">{{ selectedCustomer.issue }}</span></p>
                  <p><strong>Linh kiện thay:</strong> {{ selectedCustomer.replacedPart || 'Chưa có' }}</p>
                  <p><strong>Ngày hoàn thành:</strong> {{ selectedCustomer.doneDate }}</p>
                  <p><strong>Ngày tạo:</strong> {{ formatDate(selectedCustomer.createdAt) }}</p>
                </div>

                <div class="col-md-7">
                  <h6 class="mb-3">Ảnh & Video</h6>
                  <div class="media-grid">
                    <div v-for="(m, idx) in selectedCustomer.media || []" :key="idx" class="media-item position-relative">
                      <img v-if="m.type === 'image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh" style="cursor: pointer;">
                      <video v-else :src="m.data" controls @click="openMediaModal(m)" preload="metadata" style="cursor: pointer;"></video>
                      <span @click.stop="removeMedia(selectedCustomer, idx)" class="media-del">×</span>
                    </div>
                    <label class="media-add"><span>+</span><input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, selectedCustomer)"></label>
                  </div>

                  <!-- Link Drive (thay thế input ảnh lẻ cũ) -->
                  <div class="mt-3">
                    <label class="form-label fw-bold small text-muted">Link Drive</label>
                    <!-- Chưa có link hoặc đang edit -->
                    <div v-if="!selectedCustomer.folderDrive || isEditingLink[selectedCustomer.id]" class="input-group input-group-sm">
                      <input
                        v-model="tempFolderLink[selectedCustomer.id]"
                        class="form-control"
                        placeholder="Dán link Google Drive vào đây..."
                        @keyup.enter="saveFolderLink(selectedCustomer.id)"
                      >
                      <button @click="saveFolderLink(selectedCustomer.id)" class="btn btn-primary fw-bold">Lưu</button>
                    </div>
                    <!-- Đã có link -->
                    <div v-else class="d-flex gap-2">
                      <a :href="selectedCustomer.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">
                        📂 MỞ DRIVE
                      </a>
                      <button @click="startEditFolder(selectedCustomer.id, selectedCustomer.folderDrive)" class="btn btn-sm btn-light border fw-bold">
                        ✏️ Đổi link
                      </button>
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

      <!-- Modal phóng to media -->
      <div v-if="showModal" class="media-modal-overlay" @click="closeMediaModal">
        <div class="media-modal-content" @click.stop>
          <button class="modal-close" @click="closeMediaModal">×</button>
          <img v-if="modalMedia?.type === 'image'" :src="modalMedia.data" alt="Ảnh phóng to" class="modal-media">
          <video v-else-if="modalMedia?.type === 'video'" :src="modalMedia.data" controls autoplay class="modal-media"></video>
        </div>
      </div>

      <!-- Modal chọn linh kiện (thêm từ composable) -->
      <div v-if="showPartModal" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Chọn loại linh kiện thay</h5>
              <button type="button" class="btn-close" @click="closePartModal"></button>
            </div>
            <div class="modal-body">
              <div class="list-group">
                <button v-for="part in linhKienList" :key="part" class="list-group-item list-group-item-action" @click="selectPart(part)">{{ part }}</button>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closePartModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal CA TRỂ (từ code cũ, thêm đầy đủ) -->
      <div v-if="showTreModal" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
          <div class="modal-content">
            <div class="modal-header bg-warning text-dark">
              <h5 class="modal-title">Ca bị trễ ({{ treCaList.length }} ca)</h5>
              <button type="button" class="btn-close" @click="closeTreModal"></button>
            </div>
            <div class="modal-body p-3">
              <div v-if="treCaList.length === 0" class="text-center text-muted py-5">
                Không có ca nào bị trễ
              </div>
              <div v-else class="list-group">
                <button v-for="item in treCaList" :key="item.id" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-3" @click="selectTreCa(item)">
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

      <!-- Modal linh kiện, trễ, route (nếu cần, giữ nguyên như trước) -->
      <!-- ... (các modal khác) ... -->
    </div>
  </div>
</template>

<style scoped>
/* CSS grid responsive như ảnh (3 cột desktop, 2 tablet, 1 mobile) */
.page-wrap { min-height: 100vh; padding: 2rem 1rem; background: #f1f5f9; font-family: system-ui, -apple-system, sans-serif; }
.layout { max-width: 1450px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
.control-card, .cases-section { background: white; border-radius: 20px; padding: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }

/* 3 nút loại ca (toggle-row) */
.toggle-row { display: flex; gap: 10px; margin-bottom: 1rem; }
.toggle-row button { flex: 1; padding: 0.75rem; border-radius: 12px; font-size: 0.95rem; transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.toggle-row button:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.15); }

/* 3 nút trạng thái (status-toggle-row - mới thêm từ code 2, chỉ hiện cho ASVN/CSVN) */
.status-toggle-row { display: flex; gap: 10px; margin-bottom: 1rem; }
.status-toggle-row button { flex: 1; padding: 0.75rem; border-radius: 12px; font-size: 0.95rem; transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.status-toggle-row button:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.15); }

/* Control body */
.control-body { background: #f8f9fa; border-radius: 12px; padding: 1rem; }
.control-actions { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 10px; }

/* Section header */
.section-header { margin-bottom: 1rem; }
.section-title { font-weight: 800; color: #1e293b; font-size: 1.25rem; margin: 0; }

/* Case strip grid (phân ra như ảnh) */
.case-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem; }

/* Card styling (viền màu, hover như ảnh) */
.case-card { animation: fadeIn 0.4s ease-out; cursor: pointer; transition: all 0.2s; border-radius: 16px; overflow: hidden; }
.case-card:hover { transform: translateY(-4px); box-shadow: 0 8px 20px rgba(0,0,0,0.12) !important; }
.card { transition: all 0.3s ease; border: 1px solid #e2e8f0 !important; border-radius: 16px; height: 100%; }
.card:hover { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1) !important; }
.card-body { padding: 1.25rem; display: flex; flex-direction: column; }
.border-primary { border-left-color: #3b82f6 !important; }
.border-warning { border-left-color: #f59e0b !important; }
.border-success { border-left-color: #10b981 !important; }

/* Info & media (icon, thumbnails như ảnh) */
.info-content { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.9rem; }
.info-content .fw-bold { font-size: 1rem; }
.text-danger { color: #ef4444 !important; }
.text-info { color: #0ea5e9 !important; }
.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 0.75rem; margin: 0.75rem 0; }
.media-item { position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.media-item img, .media-item video { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; cursor: pointer; transition: transform 0.15s; }
.media-item img:hover, .media-item video:hover { transform: scale(1.05); }
.media-del { position: absolute; top: -6px; right: -6px; background: #ef4444; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 12px; cursor: pointer; z-index: 10; }
.media-add { aspect-ratio: 1; border: 2px dashed #cbd5e0; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #94a3b8; font-size: 24px; transition: border-color 0.2s; }
.media-add:hover { border-color: #3b82f6; }
.media-grid-mini { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
.media-item-mini { width: 50px; height: 50px; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.media-item-mini img, .media-item-mini video { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; cursor: pointer; }
.date-pill { background: #10b981; color: white; padding: 0.5rem 1rem; border-radius: 20px; font-weight: bold; font-size: 0.9rem; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

/* Modal styles (giữ nguyên) */
.media-modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.9); display: flex; align-items: center; justify-content: center; z-index: 1000; cursor: pointer; }
.media-modal-content { position: relative; max-width: 90vw; max-height: 90vh; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
.modal-media { max-width: 100%; max-height: 90vh; object-fit: contain; display: block; }
.modal-close { position: absolute; top: 15px; right: 20px; background: rgba(0,0,0,0.5); color: white; border: none; font-size: 32px; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; z-index: 10; }
.modal-close:hover { background: rgba(255,0,0,0.8); }
.modal-xl { max-width: 1100px; }
.modal-header.bg-success { background-color: #198754 !important; }
.modal-header.bg-info { background-color: #17a2b8 !important; }
.btn-close-white { filter: invert(1); }
.btn-info { background-color: #17a2b8; border-color: #17a2b8; }
.list-group-item-action:hover { background-color: #f8f9fa; }
.spinner-border { width: 3rem; height: 3rem; }
.list-group-item-warning { background-color: #fff3cd !important; border-left: 5px solid #ffc107 !important; }

/* Responsive (3 nút loại ca + trạng thái stack dọc mobile) */
@media (max-width: 1200px) { .case-strip { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); } }
@media (max-width: 768px) { 
  .case-strip { grid-template-columns: 1fr; gap: 1rem; } 
  .toggle-row, .status-toggle-row { flex-direction: column; gap: 0.5rem; } /* Cả 6 nút dọc mobile, nhưng OUTSIDE chỉ 3 nút loại ca */
  .page-wrap { padding: 1rem 0.5rem; } 
  .control-actions { grid-template-columns: 1fr; } 
  .info-content { font-size: 0.85rem; } 
}
</style>