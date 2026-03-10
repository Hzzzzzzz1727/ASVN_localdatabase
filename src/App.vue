<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import * as XLSX from 'xlsx'
import { getSupabase } from './lib/supabase'

import { useSupabaseCustomers } from '@/composables/useSupabaseCustomers'
import { useTicketParser } from '@/composables/useTicketParser'
import { useGeocodingAndRouting } from '@/composables/useGeocodingAndRouting'
import { useLinhKienManager } from '@/composables/useLinhKienManager'
import { useAuth } from '@/composables/useAuth'

import LoginPage from '@/components/LoginPage.vue'
import AdminPanel from '@/components/AdminPanel.vue'

// ── AUTH ──────────────────────────────────────────────────────
const {
  isLoggedIn, isAdmin, isNhanVien, isAuthLoading,
  userName, userWarehouse, canDelete, canExport,
  initAuth, logout
} = useAuth()

const showAdminPanel = ref(false)
const showStats = ref(false)

// ── SUPABASE ──────────────────────────────────────────────────
const supabase = getSupabase()
const searchQuery = ref('')
const historySearchQuery = ref('')
const { customers, loadData, loadMediaForItem } = useSupabaseCustomers()

// ── TOAST ─────────────────────────────────────────────────────
const toasts = ref([])
let toastId = 0
const showToast = (message, type = 'success', duration = 3000) => {
  const id = ++toastId
  toasts.value.push({ id, message, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, duration)
}

// ── LOADING ───────────────────────────────────────────────────
const isParsing = ref(false)

// ── TICKET PARSER ─────────────────────────────────────────────
const { rawInput, handleParse } = useTicketParser(loadData)

const customHandleParse = async (text) => {
  if (!text || !text.trim()) return
  if (isParsing.value) return
  isParsing.value = true
  const _run = async () => {
    // ── Nhánh TDP: format bảng "số sửa chữa: ASVN..." ──────────
    if (/số sửa chữa\s*:/i.test(text)) {
      const ticketIdTDP = text.match(/số sửa chữa\s*:\s*(ASVN\d+)/i)?.[1]?.toUpperCase()
      if (!ticketIdTDP) { showToast('Không tìm thấy mã ASVN!', 'error'); return }
      const { data: existTDP } = await supabase.from('customers').select('ticketId').eq('ticketId', ticketIdTDP).maybeSingle()
      if (existTDP) { showToast(`Ca ${ticketIdTDP} đã tồn tại!`, 'warning'); rawInput.value = ''; return }

      const modelTDP   = text.match(/^model\s*:\s*(.+?)$/im)?.[1]?.trim() || 'Xiaomi TV'
      const serialTDP  = text.match(/^Serial\s*:\s*(.+?)$/im)?.[1]?.trim() || ''
      const nameTDP    = text.match(/Tên khách hàng\s*:\s*(.+?)$/im)?.[1]?.trim() || 'Khách TDP'
      const rawPhTDP   = text.match(/Số điện thoại\s*:\s*([\+\d]+)/i)?.[1] || ''
      const phoneTDP   = rawPhTDP.replace(/^\+84/, '0')
      const addrRaw    = text.match(/Địa chỉ\s*:\s*(.+?)(?:\n|$)/i)?.[1] || ''
      const addressTDP = addrRaw.replace(/\s*\(cũ\)\s*/gi, '').trim()
      const issueRpt   = text.match(/Faulty description\s*:\s*(.+?)(?:\nA:|\nCS handle:|Note:|$)/is)?.[1]?.trim().replace(/\n/g,' ')
      const issueField = text.match(/Hiện tượng\s*:\s*(.+?)(?:\n|$)/i)?.[1]?.trim()
      const issueTDP   = issueRpt || issueField || 'Bảo hành TV'

      const newCaTDP = {
        ticketId: ticketIdTDP, name: nameTDP, phone: phoneTDP,
        model: modelTDP, address: addressTDP, issue: issueTDP,
        media: [], folderDrive: '', status: 0, replacedPart: 'Chưa có',
        doneDate: null, createdAt: new Date().toISOString(),
        warehouse: 'TDP', serial: serialTDP, branch: ''
      }
      const { error: errTDP } = await supabase.from('customers').insert([newCaTDP])
      if (errTDP) showToast('Lỗi lưu ca TDP: ' + errTDP.message, 'error')
      else { showToast(`✅ Đã lưu TDP: ${ticketIdTDP} - ${nameTDP}`, 'success'); await loadData() }
      rawInput.value = ''
      return
    }

    // ── Nhánh PSC: format "Số phiếu: ASVN" (không có VN-NV/NV-MSC) ──
    if (/Số phiếu\s*:/i.test(text) || /\*\s*Họ tên\s*:/i.test(text)) {
      const ticketPSC = text.match(/(?:Số phiếu|số sửa chữa)\s*:\s*(ASVN\d+)/i)?.[1]?.toUpperCase()
        || text.match(/ASVN\d+/)?.[0]?.toUpperCase()
      if (!ticketPSC) { showToast('Không tìm thấy mã ASVN!', 'error'); return }
      const { data: existPSC } = await supabase.from('customers').select('ticketId').eq('ticketId', ticketPSC).maybeSingle()
      if (existPSC) { showToast(`Ca ${ticketPSC} đã tồn tại!`, 'warning'); rawInput.value = ''; return }

      // Tên: "* Họ tên:" → "Name: xxx Phone" (inline, không lấy cả đoạn Report person)
      const namePSC = text.match(/\*\s*Họ tên\s*:\s*(.+?)$/im)?.[1]?.trim()
        || text.match(/\bName\s*:\s*(.+?)(?=\s+Phone\s*Number|\s+Address|\n|$)/i)?.[1]?.trim() || 'Khách'
      // SĐT
      const rawPhPSC = text.match(/\*\s*Điện thoại\s*:\s*([\+\d]+)/i)?.[1]
        || text.match(/Phone\s*Number\s*:\s*([\+\d]+)/i)?.[1] || ''
      const phonePSC = rawPhPSC.replace(/^\+84/, '0')
      // Địa chỉ: lấy phần ĐẦU TIÊN trước dấu ". " (bỏ địa chỉ phụ đứng sau)
      const addrRawPSC = text.match(/\*\s*Địa chỉ\s*:\s*(.+?)(?=\n\s*\*|\n\s*Tên Đại|$)/is)?.[1]
        || text.match(/\bAddress\s*:\s*(.+?)(?=\s*Faulty description|\s*CS handle|$)/is)?.[1] || ''
      const addressPSC = addrRawPSC.replace(/\n/g,' ').replace(/\s+/g,' ').trim().split(/\.\s+/)[0].trim()
      // Model: dòng riêng "Model:\nL55M6" ưu tiên hơn inline "Model: Mi TV P1 55""
      const modelPSC = text.match(/^Model\s*:\s*\n\s*(.+?)$/im)?.[1]?.trim()
        || text.match(/^Model\s*:\s*(.+?)$/im)?.[1]?.trim() || 'Xiaomi TV'
      // Serial: dòng riêng → dính liền 'Số Serial:xxx' → inline SN:
      const serialPSC = text.match(/Số Serial\s*:\s*\n\s*([^\n\s]+)/i)?.[1]
        || text.match(/Số Serial\s*:([^\n\s]+)/i)?.[1]
        || text.match(/(?:SN\s*or\s*IMEI|IMEI\s*\/\s*SN|SN)\s*:\s*([^\s\n]+)/i)?.[1] || ''
      // Issue: Faulty description → dừng tại CS handle
      const issuePSC = text.match(/Faulty description\s*:\s*(.+?)(?:\s*CS handle:|\n\n|\nSố phiếu|$)/is)?.[1]?.trim().replace(/\n/g,' ')
        || text.match(/Hiện tượng\s*:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || 'Bảo hành TV'

      // Kho: nếu text có "Số phiếu:" (portal NV) → NV, còn lại dùng tab đang đứng
      const warehousePSC = /Số phiếu\s*:/i.test(text) ? 'NV' : currentWarehouse.value

      const newCaPSC = {
        ticketId: ticketPSC, name: namePSC, phone: phonePSC,
        model: modelPSC, address: addressPSC, issue: issuePSC,
        media: [], folderDrive: '', status: 0, replacedPart: 'Chưa có',
        doneDate: null, createdAt: new Date().toISOString(),
        warehouse: warehousePSC, serial: serialPSC, branch: ''
      }
      const { error: errPSC } = await supabase.from('customers').insert([newCaPSC])
      if (errPSC) showToast('Lỗi lưu ca: ' + errPSC.message, 'error')
      else { showToast(`✅ Đã lưu ${warehousePSC}: ${ticketPSC} - ${namePSC}`, 'success'); await loadData() }
      rawInput.value = ''
      return
    }

    // ── Nhánh NV: format report "VN-NV" hoặc "NV-MSC" ──────────
    if (!text.includes('VN-NV') && !text.includes('NV-MSC')) {
      await handleParse(text)
      rawInput.value = ''
      return
    }
    const ticketIdMatch = text.match(/ASVN\d+/)
    if (!ticketIdMatch) { showToast('Không tìm thấy mã ASVN!', 'error'); return }
    const fullTicketId = ticketIdMatch[0].toUpperCase()
    const { data: exist } = await supabase.from('customers').select('ticketId').eq('ticketId', fullTicketId).maybeSingle()
    if (exist) { showToast(`Ca ${fullTicketId} đã tồn tại!`, 'warning'); rawInput.value = ''; return }

    // Tên: ưu tiên "* Họ tên:" → "Customer Name:" → prefix title
    // ── TÊN: * Họ tên → Customer Name → Report person (lấy Anh/Chị...) → prefix title
    const nameHoTen  = text.match(/\*\s*Họ tên\s*:\s*(.+?)$/im)
    const nameCust   = text.match(/Customer Name\s*:\s*(.+?)(?:\s+Customer|\n|$)/i)
    const nameReport = text.match(/Report\s*[Pp]erson\s*:.*?((?:Anh|Chị|chị|Bác|bác|Ông|ông|Bà|bà|Chú|chú|Em|em|Cô|cô)\s+[^\s\-,\n(]+)/i)
    const nameShort  = text.replace(fullTicketId, '').trim().match(/^((?:Anh|Chị|chị|Bác|bác|Ông|ông|Bà|bà|Chú|chú|Em|em|Cô|cô)\s+[^\s,|\n(]+)/)
    const name = (nameHoTen?.[1] || nameCust?.[1] || nameReport?.[1] || nameShort?.[1] || 'Khách NV').trim()

    // ── SĐT: * Điện thoại → Customer Phone → Report person (số đầu) → bất kỳ số nào
    const phoneLine  = text.match(/\*\s*Điện thoại\s*:\s*([\+\d]+)/i)
    const phoneCust  = text.match(/Customer Phone\s*:\s*([\+\d]+)/i)
    const phoneReport = text.match(/Report\s*[Pp]erson\s*:\s*([\+\d]+)/i)
    const phoneAny   = text.match(/(?<!\d)(?:\+84|0)[3-9][0-9]{8}(?!\d)/)
    const rawPhone   = phoneLine?.[1] || phoneCust?.[1] || phoneReport?.[1] || phoneAny?.[0] || ''
    const phone = rawPhone.replace(/^\+84/, '0')

    // ── ĐỊA CHỈ: * Địa chỉ → Adress/Address + cũ → Customer Address → tỉnh/thành
    const addrFull   = text.match(/\*\s*Địa chỉ\s*:\s*(.+?)(?=\n\s*\*|\n\s*Điện thoại|\n\s*Tên|\n\s*Mail|$)/is)
    const addrCu     = text.match(/[Aa]d+ress\s*:.*?(?:\+\s*c[uũ]\s*:)?\s*(.+?)(?:\s*-\s*Faulty|\s*-\s*CS\s*handle|$)/is)
    const addrCust   = text.match(/Customer [Aa]d+ress\s*:\s*(.+?)(?:\n|$)/i)
    const addrCity   = text.match(/([^\n]+?(?:Quảng Nam|Đà Nẵng|QUẢNG NAM|ĐÀ NẴNG|tỉnh|Huyện)[^\n]*)/i)
    const rawAddr    = addrFull?.[1] || addrCu?.[1] || addrCust?.[1] || addrCity?.[1] || 'Chưa bóc được địa chỉ'
    const address    = rawAddr.replace(/^\+?\s*c[uũ]\s*:\s*/i, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()

    // ── MODEL: "- Model: X" inline → dòng riêng "Model:\nX" → fallback
    const modelInline = text.match(/-\s*Model\s*:\s*(.+?)(?:\s*-\s*SN|\s*-\s*Adress|\s*-\s*Faulty|\n|$)/i)
    const modelDesc   = text.match(/Model\s*:\s*(Xiaomi[^\n\r\-]+?)(?:\n|SN:|$)/i)
    const modelLine   = text.match(/^[Mm]odel\s*:\s*(.+?)$/im)
    const model = (modelInline?.[1] || modelDesc?.[1] || modelLine?.[1] || 'Xiaomi TV').trim()

    // ── SERIAL: "SN or IMEI: X" → "IMEI/SN: X" → "SN: X" → "Số Serial:\nX"
    const serialMatch = text.match(/(?:SN\s*or\s*IMEI|IMEI\s*[\/|]\s*SN|SN\s*or\s*SN)\s*:\s*([^\s\-]+)/i)
      || text.match(/(?:IMEI\s*\/\s*SN|SN\s*:|Serial\s*:)\s*([A-Z0-9\/\-]+)/i)
      || text.match(/Số Serial\s*:\s*\n?\s*([^\n\s]+)/i)
    const serial = serialMatch?.[1]?.trim() || ''

    const branchMatch = text.match(/VN-NV-MSC-[^\s,\n]+/i)
    const branch = branchMatch?.[0]?.trim() || 'VN-NV-MSC-Đà Nẵng'

    const issueMatch = text.match(/Faulty description\s*:\s*(.+?)(?:\s*-\s*CS\s*handle:|\nCS handle:|Note:|"|\n\n|\n\*\s*Họ tên|$)/is)
    const issue = issueMatch ? issueMatch[1].trim().replace(/\n/g, ' ') : 'Bảo hành TV'

    const newCa = {
      ticketId: fullTicketId, name, phone, model, address, issue,
      media: [], folderDrive: '', status: 0, replacedPart: 'Chưa có',
      doneDate: null, createdAt: new Date().toISOString(),
      warehouse: 'NV', serial, branch
    }
    const { error } = await supabase.from('customers').insert([newCa])
    if (error) showToast('Lỗi lưu ca NV: ' + error.message, 'error')
    else { showToast(`✅ Đã lưu: ${fullTicketId} - ${name}`, 'success'); await loadData() }
    rawInput.value = ''
  }
  try { await _run() } finally { isParsing.value = false }
}

// ── ROUTING ───────────────────────────────────────────────────
const routing = useGeocodingAndRouting({ value: customers })
const { currentLocation, currentCoords, showRouteModal, routeCustomers, isLoadingRoute, openRouteModal, closeRouteModal, calculateRoute } = routing

// ── LINH KIỆN ─────────────────────────────────────────────────
const linhKien = useLinhKienManager(loadData)
const { searchTicketId, newReplacedPart, editingPart, showPartModal, linhKienList, showCustomInput, customPartInput, confirmCustomPart, openPartModal, closePartModal, selectPart, loadPartForEdit, saveLinhKien, deleteLinhKien } = linhKien

// ── STATE ─────────────────────────────────────────────────────
const currentType     = ref('ASVN')
const showWarehouse   = ref(true)
const currentWarehouse = ref('TDP')
const isEditingLink   = ref({})
const tempFolderLink  = ref({})
const showTab         = ref('danglam')
const outsideTab      = ref('danglam')

// ── CONFIRM KHO (PSC) ─────────────────────────────────────────
const showWarehouseConfirm = ref(false)
const pendingCaPSC         = ref(null)
const confirmWarehouse = async (wh) => {
  if (!pendingCaPSC.value) return
  pendingCaPSC.value.warehouse = wh
  const { error } = await supabase.from('customers').insert([pendingCaPSC.value])
  if (error) showToast('Lỗi lưu ca: ' + error.message, 'error')
  else { showToast(`✅ Đã lưu ${wh}: ${pendingCaPSC.value.ticketId} - ${pendingCaPSC.value.name}`, 'success'); await loadData() }
  showWarehouseConfirm.value = false
  pendingCaPSC.value = null
  rawInput.value = ''
}

// ── MODALS ────────────────────────────────────────────────────
const showDetailModal       = ref(false)
const selectedCustomer      = ref(null)
const editingPart2          = ref('')
const showModal             = ref(false)
const modalMedia            = ref(null)
const showTreModal          = ref(false)
const showOutsideForm       = ref(false)
const outsideForm           = ref({ name: '', phone: '', brand: '', model: '', issue: '' })
const showOutsideDetailModal = ref(false)
const selectedOutside       = ref(null)
const editingOutsidePart    = ref('')

// ── MODAL HANDLERS ────────────────────────────────────────────
const openDetailModalFull = async (customer) => {
  selectedCustomer.value = { ...customer, media: [] }
  editingPart2.value = customer.replacedPart || ''
  showDetailModal.value = true
  document.body.style.overflow = 'hidden'
  const media = await loadMediaForItem(customer.id)
  if (selectedCustomer.value) selectedCustomer.value = { ...selectedCustomer.value, media }
}
const closeDetailModal = () => {
  showDetailModal.value = false; selectedCustomer.value = null; document.body.style.overflow = ''
}

const openOutsideDetailModal = async (item) => {
  selectedOutside.value = { ...item, media: [] }
  editingOutsidePart.value = item.replacedPart || ''
  showOutsideDetailModal.value = true
  document.body.style.overflow = 'hidden'
  const media = await loadMediaForItem(item.id)
  if (selectedOutside.value) selectedOutside.value = { ...selectedOutside.value, media }
}
const closeOutsideDetailModal = () => {
  showOutsideDetailModal.value = false; selectedOutside.value = null; document.body.style.overflow = ''
}

const openTreModal   = () => showTreModal.value = true
const closeTreModal  = () => showTreModal.value = false
const openMediaModal = (media) => { modalMedia.value = media; showModal.value = true; document.body.style.overflow = 'hidden' }
const closeMediaModal = () => { showModal.value = false; modalMedia.value = null; document.body.style.overflow = '' }

// ── NAVIGATION ────────────────────────────────────────────────
const backToTypeToggle = () => { showWarehouse.value = false; currentType.value = 'ASVN' }
const selectWarehouse  = (wh) => {
  // Nhân viên có kho cố định không được đổi
  if (isNhanVien.value && userWarehouse.value && wh !== userWarehouse.value) return
  currentWarehouse.value = wh; searchQuery.value = ''
}
const selectType = (type) => {
  currentType.value = type; showTab.value = 'danglam'; outsideTab.value = 'danglam'
  searchQuery.value = ''; historySearchQuery.value = ''
  if (type === 'ASVN') showWarehouse.value = true
}

// ── THỐNG KÊ ─────────────────────────────────────────────────
const stats = computed(() => {
  const asvn = customers.value.filter(c => c.ticketId?.startsWith('ASVN'))
  const tdp  = asvn.filter(c => c.warehouse === 'TDP')
  const nv   = asvn.filter(c => c.warehouse === 'NV')
  const today = new Date().toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' })
  return {
    tongTat:   asvn.filter(c => c.status === 2).length,
    dangLamAll: asvn.filter(c => c.status === 0).length,
    choLKAll:  asvn.filter(c => c.status === 1).length,
    tdpDangLam: tdp.filter(c => c.status === 0).length,
    tdpChoLK:  tdp.filter(c => c.status === 1).length,
    tdpXong:   tdp.filter(c => c.status === 2).length,
    nvDangLam: nv.filter(c => c.status === 0).length,
    nvChoLK:   nv.filter(c => c.status === 1).length,
    nvXong:    nv.filter(c => c.status === 2).length,
    hoanThanhHomNay: asvn.filter(c => c.status === 2 && c.doneDate === today).length,
    csvnTong:  customers.value.filter(c => c.ticketId?.startsWith('CSVN')).length,
    ngoaiTong: customers.value.filter(c => c.ticketId?.startsWith('NGOAI')).length,
  }
})

// ── COMPUTED ──────────────────────────────────────────────────
const filteredCustomers = computed(() => {
  let f = customers.value
  if (currentType.value === 'ASVN')    f = f.filter(c => c.ticketId?.startsWith('ASVN'))
  else if (currentType.value === 'CSVN')   f = f.filter(c => c.ticketId?.startsWith('CSVN'))
  else if (currentType.value === 'OUTSIDE') f = f.filter(c => c.ticketId?.startsWith('NGOAI'))
  if (currentType.value === 'ASVN' && showWarehouse.value && !searchQuery.value)
    f = f.filter(c => c.warehouse === currentWarehouse.value)
  const q = searchQuery.value.toLowerCase()
  return f.filter(c =>
    c.name?.toLowerCase().includes(q) || c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) || c.model?.toLowerCase().includes(q) ||
    c.replacedPart?.toLowerCase().includes(q)
  )
})

const dangLam     = computed(() => filteredCustomers.value.filter(c => c.status === 0))
const choLinhKien = computed(() => filteredCustomers.value.filter(c => c.status === 1))
const hoanThanh   = computed(() => {
  const q = historySearchQuery.value.toLowerCase()
  let items = filteredCustomers.value.filter(c => c.status === 2)
  if (q) items = items.filter(c =>
    c.name?.toLowerCase().includes(q) || c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) || c.model?.toLowerCase().includes(q) ||
    c.replacedPart?.toLowerCase().includes(q)
  )
  const groups = {}
  items.forEach(item => { const d = item.doneDate || 'N/A'; if (!groups[d]) groups[d] = []; groups[d].push(item) })
  return groups
})
const outsideDangLam    = computed(() => filteredCustomers.value.filter(c => c.status === 0))
const outsideChoLinhKien = computed(() => filteredCustomers.value.filter(c => c.status === 1))
const outsideHoanThanh  = computed(() => filteredCustomers.value.filter(c => c.status === 2))
const treCaList = computed(() => {
  const now = Date.now()
  return filteredCustomers.value.filter(c => c.status === 0 && c.createdAt && now - new Date(c.createdAt).getTime() > 86400000)
})

const getWarehouseLabel = (item) => item.warehouse === 'TDP' ? 'Kho TDP' : item.warehouse === 'NV' ? 'Kho NV' : ''
const getWarehouseBadgeClass = (wh) => wh === 'TDP' ? 'bg-primary' : 'bg-success'

// ── CA NGOÀI ──────────────────────────────────────────────────
const openOutsideForm  = () => { showOutsideForm.value = true; outsideForm.value = { name: '', phone: '', brand: '', model: '', issue: '' } }
const closeOutsideForm = () => showOutsideForm.value = false
const saveOutsideCa = async () => {
  if (!outsideForm.value.phone || !outsideForm.value.issue) { showToast('Vui lòng nhập SĐT và tình trạng TV!', 'error'); return }
  const now = new Date()
  const ticketId = `NGOAI-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`
  const newCa = {
    ticketId, name: outsideForm.value.name.trim() || 'Khách ngoài',
    phone: outsideForm.value.phone,
    model: `${outsideForm.value.brand} ${outsideForm.value.model}`.trim() || 'Chưa rõ',
    address: 'Ca ngoài - không có địa chỉ', issue: outsideForm.value.issue,
    media: [], folderDrive: '', status: 0, replacedPart: 'Chưa có linh kiện thay',
    doneDate: null, createdAt: now.toISOString(), warehouse: 'TDP'
  }
  const { error } = await supabase.from('customers').insert([newCa])
  if (error) { showToast('Lỗi lưu ca ngoài: ' + error.message, 'error'); return }
  showToast('Đã nhận ca ngoài! Mã: ' + ticketId, 'success')
  closeOutsideForm(); loadData()
}

// ── TRẠNG THÁI ────────────────────────────────────────────────
const hoanTatKiemTra = async (item, event) => {
  if (!confirm(`Chuyển ca ${item.ticketId} sang "Chờ linh kiện"?`)) { event.target.checked = false; return }
  await supabase.from('customers').update({ status: 1 }).eq('id', item.id)
  await loadData(); showToast('Đã chuyển sang chờ linh kiện!', 'success')
}
const dongCa = async (item) => {
  if (!confirm(`Chốt hoàn thành ca ${item.ticketId}?`)) return
  const now = new Date()
  const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`
  await supabase.from('customers').update({ status: 2, doneDate: dateStr }).eq('id', item.id)
  await loadData(); showToast('Đã chốt ca hoàn thành!', 'success')
}
const revertToDangLam = async (item) => {
  await supabase.from('customers').update({ status: 0, doneDate: null }).eq('id', item.id)
  await loadData()
  if (showDetailModal.value) closeDetailModal()
  showToast('Đã hoàn lại trạng thái đang làm!', 'warning')
}
const changeStatus = async (status) => {
  if (!selectedCustomer.value) return
  const now = new Date()
  const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`
  const updates = status === 2 ? { status, doneDate: dateStr } : { status, doneDate: null }
  await supabase.from('customers').update(updates).eq('id', selectedCustomer.value.id)
  selectedCustomer.value = { ...selectedCustomer.value, ...updates }
  await loadData(); showToast('Đã cập nhật trạng thái!', 'success')
}
const changeOutsideStatus = async (status) => {
  if (!selectedOutside.value) return
  const now = new Date()
  const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`
  const updates = status === 2 ? { status, doneDate: dateStr } : { status, doneDate: null }
  await supabase.from('customers').update(updates).eq('id', selectedOutside.value.id)
  selectedOutside.value = { ...selectedOutside.value, ...updates }
  await loadData(); showToast('Đã cập nhật trạng thái!', 'success')
}
const savePartInModal = async () => {
  if (!selectedCustomer.value) return
  await supabase.from('customers').update({ replacedPart: editingPart2.value }).eq('id', selectedCustomer.value.id)
  selectedCustomer.value.replacedPart = editingPart2.value
  await loadData(); showToast('Đã lưu linh kiện!', 'success')
}
const saveOutsidePart = async () => {
  if (!selectedOutside.value) return
  await supabase.from('customers').update({ replacedPart: editingOutsidePart.value }).eq('id', selectedOutside.value.id)
  selectedOutside.value.replacedPart = editingOutsidePart.value
  await loadData(); showToast('Đã lưu linh kiện!', 'success')
}

// ── XÓA CA (chỉ admin) ───────────────────────────────────────
const deleteCustomer = async (id) => {
  if (!canDelete.value) { showToast('Bạn không có quyền xóa ca!', 'error'); return }
  const item = customers.value.find(c => c.id === id)
  if (!item) return showToast('Ca không tồn tại!', 'error')
  const msg = (showWarehouse.value && currentType.value === 'ASVN' && item.warehouse && item.warehouse !== currentWarehouse.value)
    ? `Ca này thuộc kho ${item.warehouse}, bạn có chắc xóa?`
    : 'Bạn có chắc chắn muốn xóa ca này?'
  if (!confirm(msg)) return
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) showToast('Lỗi xóa: ' + error.message, 'error')
  else { showToast('Đã xóa ca thành công!', 'success'); await loadData() }
  if (showDetailModal.value) closeDetailModal()
  if (showOutsideDetailModal.value) closeOutsideDetailModal()
}

// ── MEDIA ─────────────────────────────────────────────────────
const formatDriveLink = (link) => {
  if (!link) return null
  const m = link.match(/id=([^&]+)|d\/([^/]+)/)
  if (m) return `https://lh3.googleusercontent.com/d/${m[1] || m[2]}`
  return link
}
const updateLocalMedia = (itemId, media) => {
  if (showDetailModal.value && selectedCustomer.value?.id === itemId)
    selectedCustomer.value = { ...selectedCustomer.value, media }
  if (showOutsideDetailModal.value && selectedOutside.value?.id === itemId)
    selectedOutside.value = { ...selectedOutside.value, media }
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
  updateLocalMedia(item.id, currentMedia)
}
const addSingleDrive = async (item) => {
  const inputEl = document.getElementById(`single-drive-${item.id}`)
  if (!inputEl?.value.trim()) return
  const currentMedia = await loadMediaForItem(item.id)
  const link = inputEl.value.trim()
  currentMedia.push({ type: 'image', data: formatDriveLink(link), source: 'drive', original: link })
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  inputEl.value = ''
  updateLocalMedia(item.id, currentMedia)
}
const removeMedia = async (item, index) => {
  const currentMedia = await loadMediaForItem(item.id)
  currentMedia.splice(index, 1)
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  updateLocalMedia(item.id, currentMedia)
}

// ── DRIVE FOLDER ──────────────────────────────────────────────
const startEditFolder = (id, currentLink) => { isEditingLink.value[id] = true; tempFolderLink.value[id] = currentLink || '' }
const saveFolderLink  = async (id) => {
  const link = tempFolderLink.value[id]
  await supabase.from('customers').update({ folderDrive: link }).eq('id', id)
  isEditingLink.value[id] = false
  if (showDetailModal.value && selectedCustomer.value?.id === id) selectedCustomer.value.folderDrive = link
  if (showOutsideDetailModal.value && selectedOutside.value?.id === id) selectedOutside.value.folderDrive = link
  await loadData(); showToast('Đã lưu link Drive!', 'success')
}

// ── HELPERS ───────────────────────────────────────────────────
const selectTreCa = (item) => { searchQuery.value = item.ticketId; closeTreModal() }
const formatDate  = (dateStr) => {
  if (!dateStr) return 'Chưa có ngày tạo'
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? 'Ngày không hợp lệ'
    : d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── EXPORT (chỉ admin) ────────────────────────────────────────
const exportToExcel = (data, fileName) => {
  if (!canExport.value) { showToast('Bạn không có quyền xuất Excel!', 'error'); return }
  if (!data.length) return showToast('Không có dữ liệu!', 'error')
  const rows = data.map(item => ({
    'Kho': item.warehouse || 'N/A', 'Mã Ca': item.ticketId,
    'Ngày Hoàn thành': item.doneDate, 'Khách Hàng': item.name,
    'SĐT': item.phone, 'Model': item.model, 'Địa Chỉ': item.address,
    'Lỗi': item.issue, 'Linh kiện thay': item.replacedPart
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Báo Cáo')
  XLSX.writeFile(wb, `${fileName}.xlsx`)
}
const exportHoanThanhByWarehouse = (wh) => exportToExcel(customers.value.filter(c => c.status === 2 && c.ticketId?.startsWith('ASVN') && c.warehouse === wh), `Bao-Cao-Hoan-Thanh-${wh}`)
const exportAllHoanThanh = () => exportToExcel(customers.value.filter(c => c.status === 2 && c.ticketId?.startsWith('ASVN')), 'Bao-Cao-Hoan-Thanh-All')

// ── MOUNTED ───────────────────────────────────────────────────
onMounted(async () => {
  await initAuth()
  if (isLoggedIn.value) {
    await loadData()
    // Set kho mặc định theo quyền user
    if (isNhanVien.value && userWarehouse.value) {
      currentWarehouse.value = userWarehouse.value
    } else {
      currentWarehouse.value = 'TDP'
    }
  }
  // Watch: reset kho khi user thay đổi (login/logout)
  watch(isLoggedIn, async (val) => {
    if (val) {
      await loadData()
      if (isNhanVien.value && userWarehouse.value) {
        currentWarehouse.value = userWarehouse.value
      } else {
        currentWarehouse.value = 'TDP'
      }
    }
  })

  // Realtime: tự động cập nhật khi có thay đổi từ thiết bị khác
  const realtimeChannel = supabase
    .channel('customers-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
      loadData()
    })
    .subscribe()

  const channel = new BroadcastChannel('zalo_bridge')
  channel.onmessage = (event) => { if (event.data) customHandleParse(event.data) }
  window.addEventListener('focus', async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && (text.includes('ASVN') || text.includes('CSVN'))) customHandleParse(text)
    } catch {}
  })
})
</script>

<template>

  <!-- Đang tải auth -->
  <div v-if="isAuthLoading" class="auth-loading">
    <div class="spinner-border text-primary" style="width:3rem;height:3rem;"></div>
    <p class="mt-3 text-muted fw-bold">Đang tải...</p>
  </div>

  <!-- Chưa login -->
  <LoginPage v-else-if="!isLoggedIn" />

  <!-- App chính -->
  <div v-else class="page-wrap">

    <!-- TOAST -->
    <div class="toast-container">
      <div v-for="t in toasts" :key="t.id" :class="['toast-item', `toast-${t.type}`]">{{ t.message }}</div>
    </div>

    <!-- TOP BAR -->
    <div class="topbar">
      <div class="topbar-left">
        <span class="topbar-logo">📺</span>
        <span class="topbar-appname">TV Repair</span>
        <span :class="['role-chip', isAdmin ? 'role-admin' : 'role-nv']">
          {{ isAdmin ? '👑 Admin' : '👷 Nhân viên' }}
        </span>
      </div>
      <div class="topbar-right">
        <span class="topbar-user">{{ userName }}</span>
        <button v-if="isAdmin"
          @click="showStats = !showStats"
          :class="['btn-topbar', showStats ? 'btn-topbar--active' : '']">
          📊 Thống kê
        </button>
        <button v-if="isAdmin"
          @click="showAdminPanel = !showAdminPanel"
          :class="['btn-topbar', showAdminPanel ? 'btn-topbar--active' : '']">
          👥 Quản lý TK
        </button>
        <button @click="logout" class="btn-topbar btn-topbar--logout">🚪 Thoát</button>
      </div>
    </div>

    <!-- STATS PANEL -->
    <div v-if="showStats && isAdmin" class="stats-wrap">
      <div class="stats-grid">
        <div class="stat-card stat-blue">
          <div class="stat-num">{{ stats.dangLamAll }}</div>
          <div class="stat-label">⚡ Đang làm</div>
        </div>
        <div class="stat-card stat-yellow">
          <div class="stat-num">{{ stats.choLKAll }}</div>
          <div class="stat-label">⏳ Chờ linh kiện</div>
        </div>
        <div class="stat-card stat-green">
          <div class="stat-num">{{ stats.tongTat }}</div>
          <div class="stat-label">✅ Tổng hoàn thành</div>
        </div>
        <div class="stat-card stat-teal">
          <div class="stat-num">{{ stats.hoanThanhHomNay }}</div>
          <div class="stat-label">🗓️ Xong hôm nay</div>
        </div>
      </div>
      <div class="stats-row2">
        <div class="stat-wh">
          <div class="stat-wh-title">🏭 Kho TDP</div>
          <div class="stat-wh-row"><span class="s-blue">{{ stats.tdpDangLam }} đang làm</span> · <span class="s-yellow">{{ stats.tdpChoLK }} chờ LK</span> · <span class="s-green">{{ stats.tdpXong }} xong</span></div>
        </div>
        <div class="stat-wh">
          <div class="stat-wh-title">🏭 Kho NV</div>
          <div class="stat-wh-row"><span class="s-blue">{{ stats.nvDangLam }} đang làm</span> · <span class="s-yellow">{{ stats.nvChoLK }} chờ LK</span> · <span class="s-green">{{ stats.nvXong }} xong</span></div>
        </div>
        <div class="stat-wh">
          <div class="stat-wh-title">📋 Khác</div>
          <div class="stat-wh-row"><span class="s-blue">CSVN: {{ stats.csvnTong }}</span> · <span class="s-blue">Ca ngoài: {{ stats.ngoaiTong }}</span></div>
        </div>
      </div>
    </div>

    <!-- ADMIN PANEL -->
    <div v-if="showAdminPanel && isAdmin" class="admin-panel-wrap">
      <AdminPanel />
    </div>

    <div class="layout">
      <div class="control-card">

        <!-- Toggle loại ca -->
        <div v-if="!showWarehouse || currentType !== 'ASVN'" class="toggle-row">
          <button @click="selectType('ASVN'); showWarehouse = true"
            :class="['btn fw-bold flex-grow-1', currentType==='ASVN' ? 'btn-primary text-white' : 'btn-outline-primary']">📋 ASVN</button>
          <button @click="selectType('CSVN'); showWarehouse = false"
            :class="['btn fw-bold flex-grow-1', currentType==='CSVN' ? 'btn-primary text-white' : 'btn-outline-primary']">📋 CSVN</button>
          <button @click="selectType('OUTSIDE'); showWarehouse = false"
            :class="['btn fw-bold flex-grow-1', currentType==='OUTSIDE' ? 'btn-primary text-white' : 'btn-outline-primary']">📝 Ca Ngoài</button>
        </div>

        <!-- Warehouse toggle -->
        <div v-if="showWarehouse && currentType === 'ASVN'" class="warehouse-toggle-row">
          <div class="gear-container">
            <button @click="backToTypeToggle" class="btn-gear" title="Quay về phân loại">⚙️</button>
          </div>
          <div class="warehouse-buttons">
            <button @click="selectWarehouse('TDP'); showTab = 'danglam'"
              :class="['btn fw-bold flex-grow-1', currentWarehouse==='TDP' ? 'btn-primary text-white' : 'btn-outline-primary']">🏭 TDP</button>
            <button @click="selectWarehouse('NV'); showTab = 'danglam'"
              :class="['btn fw-bold flex-grow-1', currentWarehouse==='NV' ? 'btn-success text-white' : 'btn-outline-success']">🏭 NV</button>
          </div>
        </div>

        <!-- Tabs ASVN/CSVN -->
        <div v-if="currentType !== 'OUTSIDE'" class="status-toggle-row">
          <button @click="showTab = 'danglam'" :class="['btn fw-bold flex-grow-1', showTab==='danglam' ? 'btn-primary text-white' : 'btn-outline-primary']">
            ⚡ <span class="tab-label">ĐANG LÀM</span> ({{ dangLam.length }})
          </button>
          <button @click="showTab = 'cholinkien'" :class="['btn fw-bold flex-grow-1', showTab==='cholinkien' ? 'btn-warning text-white' : 'btn-outline-warning']">
            ⏳ <span class="tab-label">CHỜ LK</span> ({{ choLinhKien.length }})
          </button>
          <button @click="showTab = 'hoanthanh'" :class="['btn fw-bold flex-grow-1', showTab==='hoanthanh' ? 'btn-success text-white' : 'btn-outline-success']">
            ✅ <span class="tab-label">XONG</span> ({{ Object.values(hoanThanh).flat().length }})
          </button>
        </div>

        <!-- Tabs Ca Ngoài -->
        <div v-if="currentType === 'OUTSIDE'" class="status-toggle-row">
          <button @click="outsideTab = 'danglam'" :class="['btn fw-bold flex-grow-1', outsideTab==='danglam' ? 'btn-primary text-white' : 'btn-outline-primary']">
            ⚡ <span class="tab-label">ĐANG LÀM</span> ({{ outsideDangLam.length }})
          </button>
          <button @click="outsideTab = 'cholinkien'" :class="['btn fw-bold flex-grow-1', outsideTab==='cholinkien' ? 'btn-warning text-white' : 'btn-outline-warning']">
            ⏳ <span class="tab-label">CHỜ LK</span> ({{ outsideChoLinhKien.length }})
          </button>
          <button @click="outsideTab = 'hoanthanh'" :class="['btn fw-bold flex-grow-1', outsideTab==='hoanthanh' ? 'btn-success text-white' : 'btn-outline-success']">
            ✅ <span class="tab-label">XONG</span> ({{ outsideHoanThanh.length }})
          </button>
        </div>

        <!-- Control body ASVN / CSVN -->
        <div v-if="currentType === 'ASVN' || currentType === 'CSVN'">
          <div v-if="showTab === 'danglam'" class="control-body">
            <div class="d-flex justify-content-between align-items-start mb-3">
              <textarea v-model="rawInput" rows="2" class="form-control flex-grow-1 me-3"
                placeholder="Dán nội dung hoặc đợi tin nhắn Zalo..."
                @keyup.enter="customHandleParse(rawInput)"></textarea>
              <div class="position-relative" style="min-width:50px;">
                <button class="btn btn-outline-warning position-relative rounded-circle p-2 shadow"
                  style="width:50px;height:50px;display:flex;align-items:center;justify-content:center;"
                  @click="openTreModal">
                  <span style="font-size:1.8rem;">🔔</span>
                  <span v-if="treCaList.length > 0"
                    class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger border border-white"
                    style="font-size:0.75rem;min-width:20px;height:20px;line-height:1.2;padding:0;">
                    {{ treCaList.length }}
                  </span>
                </button>
              </div>
            </div>
            <div class="control-actions">
              <button @click="customHandleParse(rawInput)" class="btn btn-primary fw-bold" :disabled="isParsing">
                <span v-if="isParsing" class="spinner-border spinner-border-sm me-1"></span>
                {{ isParsing ? 'ĐANG XỬ LÝ...' : 'NHẬP KHÁCH' }}
              </button>
              <button @click="openRouteModal" class="btn btn-info fw-bold">🗺️ HÀNH TRÌNH</button>
              <input type="text" v-model="searchQuery" class="form-control" placeholder="🔍 Tìm kiếm nhanh...">
            </div>
          </div>

          <div v-else-if="showTab === 'cholinkien'" class="control-body">
            <div class="d-flex flex-column gap-3">
              <div class="d-flex gap-3 flex-wrap align-items-end">
                <input v-model="searchTicketId" type="text" class="form-control flex-grow-1"
                  placeholder="Nhập mã ASVN cần cập nhật..." @keyup.enter="loadPartForEdit">
                <button @click="loadPartForEdit" class="btn btn-outline-primary">Tìm</button>
              </div>
              <div class="d-flex gap-3 flex-wrap align-items-end">
                <input v-model="newReplacedPart" type="text" class="form-control flex-grow-1"
                  :placeholder="editingPart ? 'Sửa linh kiện...' : 'Loại linh kiện thay...'"
                  @click="openPartModal">
                <button @click="saveLinhKien" class="btn btn-success px-4 fw-bold">{{ editingPart ? 'Sửa' : 'Lưu' }}</button>
                <button v-if="editingPart" @click="deleteLinhKien" class="btn btn-danger px-4 fw-bold">Xóa</button>
              </div>
              <input v-model="searchQuery" type="text" class="form-control" placeholder="Tìm theo tên, sđt, mã ca, model, linh kiện...">
            </div>
          </div>

          <div v-else-if="showTab === 'hoanthanh'" class="control-body">
            <div class="d-flex gap-2 flex-wrap">
              <input type="text" v-model="historySearchQuery" class="form-control flex-grow-1 mb-2"
                placeholder="🔍 Tìm trong lịch sử...">
              <!-- Xuất Excel: chỉ admin -->
              <template v-if="isAdmin">
                <div v-if="showWarehouse" class="d-flex gap-1 w-100">
                  <button @click="exportHoanThanhByWarehouse('TDP')" class="btn btn-outline-primary fw-bold flex-grow-1">📊 TDP</button>
                  <button @click="exportHoanThanhByWarehouse('NV')"  class="btn btn-outline-success fw-bold flex-grow-1">📊 NV</button>
                </div>
                <button v-else @click="exportAllHoanThanh" class="btn btn-outline-dark fw-bold">📊 XUẤT EXCEL</button>
              </template>
            </div>
          </div>
        </div>

        <!-- Control body Ca Ngoài -->
        <div v-else-if="currentType === 'OUTSIDE'" class="control-body">
          <button @click="openOutsideForm" class="btn btn-success fw-bold w-100 py-3 mb-2">+ NHẬN CA NGOÀI MỚI</button>
          <input type="text" v-model="searchQuery" class="form-control mt-1" placeholder="🔍 Tìm kiếm nhanh...">
        </div>
      </div>

      <!-- CASES -->
      <section class="cases-section">
        <div class="section-header">
          <h2 class="section-title">
            {{ currentType === 'ASVN' ? 'Ca ASVN' : currentType === 'CSVN' ? 'Ca CSVN' : 'Ca Ngoài' }}
            <span v-if="showWarehouse && currentType === 'ASVN' && !searchQuery && showTab !== 'hoanthanh'"
              class="badge ms-2" :class="getWarehouseBadgeClass(currentWarehouse)">{{ currentWarehouse }}</span>
          </h2>
        </div>

        <!-- ── ASVN / CSVN ── -->
        <div v-if="currentType !== 'OUTSIDE'">

          <!-- Đang làm -->
          <div v-if="showTab === 'danglam'">
            <div v-if="dangLam.length">
              <h5 class="mb-3">Đang làm ({{ dangLam.length }})</h5>
              <div class="case-strip">
                <div v-for="item in dangLam" :key="item.id" class="case-card"
                  @click="openDetailModalFull(item)" style="cursor:pointer;">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-primary d-flex flex-column">
                      <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                          <input type="checkbox" @click.stop @change="hoanTatKiemTra(item, $event)" style="width:20px;height:20px;">
                          <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                          <span v-if="item.warehouse" class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) }}</span>
                          <span class="badge bg-secondary">Chờ xử lý</span>
                        </div>
                        <button v-if="isAdmin" @click.stop="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">🗑️</button>
                      </div>
                      <div class="info-content">
                        <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                        <a :href="'tel:'+item.phone" @click.stop class="fw-bold text-secondary mb-1 d-block text-decoration-none">📞 {{ item.phone }}</a>
                        <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                        <div class="small text-muted mb-2">📍 {{ item.address }}</div>
                        <div class="text-danger small fw-bold mb-2">⚠️ {{ item.issue }}</div>
                        <div class="text-info small fw-bold">🔧 {{ item.replacedPart || 'Chưa có linh kiện' }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca đang làm</div>
          </div>

          <!-- Chờ linh kiện -->
          <div v-if="showTab === 'cholinkien'">
            <div v-if="choLinhKien.length">
              <h5 class="mb-3">Chờ linh kiện ({{ choLinhKien.length }})</h5>
              <div class="case-strip">
                <div v-for="item in choLinhKien" :key="item.id" class="case-card"
                  @click="openDetailModalFull(item)" style="cursor:pointer;">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-warning d-flex flex-column">
                      <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                          <button @click.stop="dongCa(item)" class="btn btn-sm btn-success">Chốt ca</button>
                          <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                          <span v-if="item.warehouse" class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) }}</span>
                          <span class="badge bg-warning text-dark">Chờ linh kiện</span>
                        </div>
                        <button v-if="isAdmin" @click.stop="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">🗑️</button>
                      </div>
                      <div class="info-content">
                        <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                        <a :href="'tel:'+item.phone" @click.stop class="fw-bold text-secondary mb-1 d-block text-decoration-none">📞 {{ item.phone }}</a>
                        <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                        <div class="small text-muted mb-2">📍 {{ item.address }}</div>
                        <div class="text-danger small fw-bold mb-2">⚠️ {{ item.issue }}</div>
                        <div class="text-info small fw-bold">🔧 {{ item.replacedPart || 'Chưa có linh kiện' }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca chờ linh kiện</div>
          </div>

          <!-- Hoàn thành -->
          <div v-if="showTab === 'hoanthanh'">
            <div v-if="Object.keys(hoanThanh).length">
              <h5 class="mb-3">Hoàn thành</h5>
              <div v-for="(group, date) in hoanThanh" :key="date" class="mb-4">
                <div class="mb-3"><span class="date-pill">📅 {{ date }} ({{ group.length }} ca)</span></div>
                <div class="case-strip">
                  <div v-for="item in group" :key="item.id" class="case-card"
                    @click="openDetailModalFull(item)" style="cursor:pointer;">
                    <div class="card border-0 shadow-sm">
                      <div class="card-body border-start border-5 border-success">
                        <div class="d-flex justify-content-between mb-2 flex-wrap gap-2">
                          <span class="fw-bold text-success">{{ item.ticketId }} - {{ item.name }}</span>
                          <span v-if="item.warehouse" class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) }}</span>
                          <button @click.stop="revertToDangLam(item)" class="btn btn-sm btn-warning">Hoàn lại</button>
                        </div>
                        <div class="small text-muted">{{ item.phone }} | {{ item.model }} | {{ item.replacedPart || 'Chưa có' }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca hoàn thành</div>
          </div>
        </div>

        <!-- ── CA NGOÀI ── -->
        <div v-else-if="currentType === 'OUTSIDE'">
          <!-- Đang làm -->
          <div v-if="outsideTab === 'danglam'">
            <div v-if="outsideDangLam.length">
              <h5 class="mb-3">Đang làm ({{ outsideDangLam.length }})</h5>
              <div class="case-strip">
                <div v-for="item in outsideDangLam" :key="item.id" class="case-card"
                  @click="openOutsideDetailModal(item)" style="cursor:pointer;">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-primary">
                      <div class="d-flex justify-content-between align-items-start mb-2">
                        <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                        <button v-if="isAdmin" @click.stop="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">🗑️</button>
                      </div>
                      <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                      <a :href="'tel:'+item.phone" @click.stop class="fw-bold text-secondary mb-1 d-block text-decoration-none">📞 {{ item.phone }}</a>
                      <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                      <div class="text-danger small fw-bold mb-1">⚠️ {{ item.issue }}</div>
                      <div class="text-info small fw-bold">🔧 {{ item.replacedPart || 'Chưa có' }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca ngoài đang làm</div>
          </div>
          <!-- Chờ LK -->
          <div v-if="outsideTab === 'cholinkien'">
            <div v-if="outsideChoLinhKien.length">
              <h5 class="mb-3">Chờ linh kiện ({{ outsideChoLinhKien.length }})</h5>
              <div class="case-strip">
                <div v-for="item in outsideChoLinhKien" :key="item.id" class="case-card"
                  @click="openOutsideDetailModal(item)" style="cursor:pointer;">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-warning">
                      <div class="d-flex justify-content-between align-items-start mb-2">
                        <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                        <button v-if="isAdmin" @click.stop="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">🗑️</button>
                      </div>
                      <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                      <a :href="'tel:'+item.phone" @click.stop class="fw-bold text-secondary mb-1 d-block text-decoration-none">📞 {{ item.phone }}</a>
                      <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                      <div class="text-danger small fw-bold mb-1">⚠️ {{ item.issue }}</div>
                      <div class="text-info small fw-bold">🔧 {{ item.replacedPart || 'Chưa có' }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca ngoài chờ linh kiện</div>
          </div>
          <!-- Hoàn thành -->
          <div v-if="outsideTab === 'hoanthanh'">
            <div v-if="outsideHoanThanh.length">
              <h5 class="mb-3">Hoàn thành ({{ outsideHoanThanh.length }})</h5>
              <div class="case-strip">
                <div v-for="item in outsideHoanThanh" :key="item.id" class="case-card"
                  @click="openOutsideDetailModal(item)" style="cursor:pointer;">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-success">
                      <div class="d-flex justify-content-between align-items-start mb-2">
                        <span class="fw-bold text-success">{{ item.ticketId }}</span>
                        <button v-if="isAdmin" @click.stop="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">🗑️</button>
                      </div>
                      <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                      <a :href="'tel:'+item.phone" @click.stop class="fw-bold text-secondary mb-1 d-block text-decoration-none">📞 {{ item.phone }}</a>
                      <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                      <div class="text-danger small fw-bold mb-1">⚠️ {{ item.issue }}</div>
                      <div class="text-info small fw-bold">🔧 {{ item.replacedPart || 'Chưa có' }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca ngoài hoàn thành</div>
          </div>
        </div>
      </section>

      <!-- ══ MODAL CHI TIẾT ASVN/CSVN ══ -->
      <div v-if="showDetailModal && selectedCustomer" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.7);">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header text-white"
              :style="{backgroundColor: selectedCustomer.status===0?'#3b82f6':selectedCustomer.status===1?'#f59e0b':'#198754'}">
              <h5 class="modal-title">
                {{ selectedCustomer.ticketId }}
                <span class="badge ms-2 bg-white fw-bold"
                  :style="{color: selectedCustomer.status===0?'#3b82f6':selectedCustomer.status===1?'#f59e0b':'#198754'}">
                  {{ selectedCustomer.status===0?'Đang làm':selectedCustomer.status===1?'Chờ linh kiện':'Hoàn thành' }}
                </span>
              </h5>
              <button type="button" class="btn-close btn-close-white" @click="closeDetailModal"></button>
            </div>
            <div class="modal-body">
              <div class="row">
                <div class="col-md-5">
                  <h5 class="mb-1 fw-bold">{{ selectedCustomer.name }}</h5>
                  <a :href="'tel:'+selectedCustomer.phone" class="text-secondary fw-bold mb-2 d-block text-decoration-none">📞 {{ selectedCustomer.phone }}</a>
                  <p v-if="selectedCustomer.warehouse"><strong>Kho:</strong> {{ selectedCustomer.warehouse }}</p>
                  <p v-if="selectedCustomer.serial"><strong>Serial:</strong> {{ selectedCustomer.serial }}</p>
                  <p v-if="selectedCustomer.branch"><strong>Chi nhánh:</strong> {{ selectedCustomer.branch }}</p>
                  <p><strong>Model:</strong> {{ selectedCustomer.model }}</p>
                  <p><strong>Địa chỉ:</strong> {{ selectedCustomer.address }}</p>
                  <p><strong>Lỗi:</strong> <span class="text-danger fw-bold">{{ selectedCustomer.issue }}</span></p>
                  <p><strong>Ngày tạo:</strong> {{ formatDate(selectedCustomer.createdAt) }}</p>
                  <p v-if="selectedCustomer.doneDate"><strong>Ngày hoàn thành:</strong> {{ selectedCustomer.doneDate }}</p>
                  <div class="mt-3 mb-3">
                    <label class="form-label fw-bold">Chuyển trạng thái:</label>
                    <div class="d-flex gap-2 flex-wrap">
                      <button @click="changeStatus(0)" :class="['btn fw-bold flex-grow-1', selectedCustomer.status===0?'btn-primary':'btn-outline-primary']">⚡ Đang làm</button>
                      <button @click="changeStatus(1)" :class="['btn fw-bold flex-grow-1', selectedCustomer.status===1?'btn-warning':'btn-outline-warning']">⏳ Chờ LK</button>
                      <button @click="changeStatus(2)" :class="['btn fw-bold flex-grow-1', selectedCustomer.status===2?'btn-success':'btn-outline-success']">✅ Xong</button>
                    </div>
                  </div>
                  <div class="mt-3">
                    <label class="form-label fw-bold">Linh kiện thay:</label>
                    <div class="input-group mb-1">
                      <input v-model="editingPart2" type="text" class="form-control" placeholder="Nhập linh kiện..." @keyup.enter="savePartInModal">
                      <button @click="savePartInModal" class="btn btn-success fw-bold">Lưu</button>
                    </div>
                    <small class="text-muted">Hiện tại: {{ selectedCustomer.replacedPart || 'Chưa có' }}</small>
                  </div>
                  <div class="mt-3">
                    <label class="form-label fw-bold">Link Drive:</label>
                    <div v-if="!selectedCustomer.folderDrive || isEditingLink[selectedCustomer.id]" class="input-group input-group-sm">
                      <input v-model="tempFolderLink[selectedCustomer.id]" class="form-control" placeholder="Dán link Google Drive..." @keyup.enter="saveFolderLink(selectedCustomer.id)">
                      <button @click="saveFolderLink(selectedCustomer.id)" class="btn btn-primary fw-bold">Lưu</button>
                    </div>
                    <div v-else class="d-flex gap-2">
                      <a :href="selectedCustomer.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">📂 MỞ DRIVE</a>
                      <button @click="startEditFolder(selectedCustomer.id, selectedCustomer.folderDrive)" class="btn btn-sm btn-light border fw-bold">✏️</button>
                    </div>
                  </div>
                </div>
                <div class="col-md-7">
                  <h6 class="mb-3">Ảnh &amp; Video</h6>
                  <div v-if="!selectedCustomer.media?.length" class="text-muted small mb-3">⏳ Đang tải ảnh...</div>
                  <div class="media-grid">
                    <div v-for="(m, idx) in selectedCustomer.media || []" :key="idx" class="media-item position-relative">
                      <img v-if="m.type==='image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh" style="cursor:pointer;">
                      <video v-else :src="m.data" controls preload="metadata"></video>
                      <span @click.stop="removeMedia(selectedCustomer, idx)" class="media-del">×</span>
                    </div>
                    <label class="media-add">
                      <span>+</span>
                      <input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, selectedCustomer)">
                    </label>
                  </div>
                  <div class="input-group input-group-sm mt-2">
                    <input :id="'single-drive-'+selectedCustomer.id" class="form-control" placeholder="Link ảnh lẻ..." @keyup.enter="addSingleDrive(selectedCustomer)">
                    <button @click="addSingleDrive(selectedCustomer)" class="btn btn-outline-primary">Thêm</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button v-if="isAdmin" @click="deleteCustomer(selectedCustomer.id)" class="btn btn-danger">🗑️ Xóa ca</button>
              <button type="button" class="btn btn-secondary" @click="closeDetailModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ MODAL CHI TIẾT CA NGOÀI ══ -->
      <div v-if="showOutsideDetailModal && selectedOutside" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.7);">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header text-white"
              :style="{backgroundColor: selectedOutside.status===0?'#3b82f6':selectedOutside.status===1?'#f59e0b':'#198754'}">
              <h5 class="modal-title">
                {{ selectedOutside.ticketId }}
                <span class="badge ms-2 bg-white fw-bold"
                  :style="{color: selectedOutside.status===0?'#3b82f6':selectedOutside.status===1?'#f59e0b':'#198754'}">
                  {{ selectedOutside.status===0?'Đang làm':selectedOutside.status===1?'Chờ linh kiện':'Hoàn thành' }}
                </span>
              </h5>
              <button type="button" class="btn-close btn-close-white" @click="closeOutsideDetailModal"></button>
            </div>
            <div class="modal-body">
              <div class="row">
                <div class="col-md-5">
                  <h5 class="mb-1 fw-bold">{{ selectedOutside.name }}</h5>
                  <a :href="'tel:'+selectedOutside.phone" class="text-secondary fw-bold mb-3 d-block text-decoration-none">📞 {{ selectedOutside.phone }}</a>
                  <p><strong>Model:</strong> {{ selectedOutside.model }}</p>
                  <p><strong>Lỗi:</strong> <span class="text-danger fw-bold">{{ selectedOutside.issue }}</span></p>
                  <p><strong>Ngày tạo:</strong> {{ formatDate(selectedOutside.createdAt) }}</p>
                  <p v-if="selectedOutside.doneDate"><strong>Ngày hoàn thành:</strong> {{ selectedOutside.doneDate }}</p>
                  <div class="mt-3 mb-3">
                    <label class="form-label fw-bold">Chuyển trạng thái:</label>
                    <div class="d-flex gap-2 flex-wrap">
                      <button @click="changeOutsideStatus(0)" :class="['btn fw-bold flex-grow-1', selectedOutside.status===0?'btn-primary':'btn-outline-primary']">⚡ Đang làm</button>
                      <button @click="changeOutsideStatus(1)" :class="['btn fw-bold flex-grow-1', selectedOutside.status===1?'btn-warning':'btn-outline-warning']">⏳ Chờ LK</button>
                      <button @click="changeOutsideStatus(2)" :class="['btn fw-bold flex-grow-1', selectedOutside.status===2?'btn-success':'btn-outline-success']">✅ Xong</button>
                    </div>
                  </div>
                  <div class="mt-3">
                    <label class="form-label fw-bold">Linh kiện thay:</label>
                    <div class="input-group mb-1">
                      <input v-model="editingOutsidePart" type="text" class="form-control" placeholder="Nhập linh kiện..." @keyup.enter="saveOutsidePart">
                      <button @click="saveOutsidePart" class="btn btn-success fw-bold">Lưu</button>
                    </div>
                    <small class="text-muted">Hiện tại: {{ selectedOutside.replacedPart || 'Chưa có' }}</small>
                  </div>
                  <div class="mt-3">
                    <label class="form-label fw-bold">Link Drive:</label>
                    <div v-if="!selectedOutside.folderDrive || isEditingLink[selectedOutside.id]" class="input-group input-group-sm">
                      <input v-model="tempFolderLink[selectedOutside.id]" class="form-control" placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(selectedOutside.id)">
                      <button @click="saveFolderLink(selectedOutside.id)" class="btn btn-primary">Lưu</button>
                    </div>
                    <div v-else class="d-flex gap-2">
                      <a :href="selectedOutside.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">📂 MỞ DRIVE</a>
                      <button @click="startEditFolder(selectedOutside.id, selectedOutside.folderDrive)" class="btn btn-sm btn-light border">✏️</button>
                    </div>
                  </div>
                </div>
                <div class="col-md-7">
                  <h6 class="mb-3">Ảnh &amp; Video</h6>
                  <div v-if="!selectedOutside.media?.length" class="text-muted small mb-3">⏳ Đang tải ảnh...</div>
                  <div class="media-grid">
                    <div v-for="(m, idx) in selectedOutside.media || []" :key="idx" class="media-item position-relative">
                      <img v-if="m.type==='image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh" style="cursor:pointer;">
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
              <button v-if="isAdmin" @click="deleteCustomer(selectedOutside.id)" class="btn btn-danger">🗑️ Xóa ca</button>
              <button type="button" class="btn btn-secondary" @click="closeOutsideDetailModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ MODAL NHẬN CA NGOÀI MỚI ══ -->
      <div v-if="showOutsideForm" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title">Nhận Ca Ngoài Mới</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeOutsideForm"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3"><label class="form-label fw-bold">Tên khách hàng</label>
                <input v-model="outsideForm.name" type="text" class="form-control" placeholder="VD: Anh Hòa, Chị Mai..."></div>
              <div class="mb-3"><label class="form-label fw-bold">SĐT <span class="text-danger">*</span></label>
                <input v-model="outsideForm.phone" type="tel" class="form-control" placeholder="0905123456"></div>
              <div class="mb-3"><label class="form-label fw-bold">Hãng TV</label>
                <input v-model="outsideForm.brand" type="text" class="form-control" placeholder="Xiaomi, Samsung, LG..."></div>
              <div class="mb-3"><label class="form-label fw-bold">Model TV</label>
                <input v-model="outsideForm.model" type="text" class="form-control" placeholder="VD: TV A2 2025"></div>
              <div class="mb-3"><label class="form-label fw-bold">Tình trạng <span class="text-danger">*</span></label>
                <textarea v-model="outsideForm.issue" class="form-control" rows="4" placeholder="VD: Màn hình đen..."></textarea></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeOutsideForm">Đóng</button>
              <button type="button" class="btn btn-success" @click="saveOutsideCa">Lưu Ca Ngoài</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ MODAL PHÓNG TO MEDIA ══ -->
      <div v-if="showModal" class="media-modal-overlay" @click="closeMediaModal">
        <div class="media-modal-content" @click.stop>
          <button class="modal-close" @click="closeMediaModal">×</button>
          <img v-if="modalMedia?.type==='image'" :src="modalMedia.data" alt="Ảnh phóng to" class="modal-media">
          <video v-else-if="modalMedia?.type==='video'" :src="modalMedia.data" controls autoplay class="modal-media"></video>
        </div>
      </div>

      <!-- ══ MODAL CHỌN LINH KIỆN ══ -->
      <div v-if="showPartModal" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.5);">
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
                <p class="text-muted mb-3">Nhập tên linh kiện:</p>
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

      <!-- ══ MODAL CA TRỄ ══ -->
      <div v-if="showTreModal" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.5);">
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

      <!-- ══ MODAL HÀNH TRÌNH ══ -->
      <div v-if="showRouteModal" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.7);overflow-y:auto;">
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
                    placeholder="VD: 123 Nguyễn Văn Linh, Đà Nẵng" @keyup.enter="calculateRoute">
                  <button @click="calculateRoute" :disabled="isLoadingRoute" class="btn btn-info fw-bold">
                    {{ isLoadingRoute ? '⏳ Đang tính...' : '🚀 Tính tuyến đường' }}
                  </button>
                </div>
              </div>
              <div v-if="currentCoords" class="alert alert-success mb-4">
                ✅ Vị trí: <strong>{{ currentCoords.displayName || `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}` }}</strong>
              </div>
              <div v-if="isLoadingRoute" class="text-center py-5">
                <div class="spinner-border text-info" style="width:3rem;height:3rem;"></div>
                <p class="mt-3 fw-bold">Đang tính toán khoảng cách...</p>
              </div>
              <div v-else-if="routeCustomers.length">
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
/* ── Auth loading ─────────────────────────────────────────── */
.auth-loading {
  min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
}

/* ── Topbar ───────────────────────────────────────────────── */
.topbar {
  display: flex; justify-content: space-between; align-items: center;
  background: #1e293b; color: #fff;
  padding: 0.6rem 1.25rem; position: sticky; top: 0; z-index: 100;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}
.topbar-left  { display: flex; align-items: center; gap: 0.6rem; }
.topbar-logo  { font-size: 1.4rem; }
.topbar-appname { font-weight: 800; font-size: 1rem; letter-spacing: -0.02em; }
.role-chip    { padding: 0.2rem 0.65rem; border-radius: 20px; font-size: 0.75rem; font-weight: 700; }
.role-admin   { background: #fef3c7; color: #92400e; }
.role-nv      { background: #dbeafe; color: #1d4ed8; }
.topbar-right { display: flex; align-items: center; gap: 0.6rem; }
.topbar-user  { font-size: 0.85rem; color: #94a3b8; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-topbar   { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 0.35rem 0.75rem; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all .2s; }
.btn-topbar:hover { background: rgba(255,255,255,0.2); }
.btn-topbar--active { background: #3b82f6; border-color: #3b82f6; }
.btn-topbar--logout { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.4); }
.btn-topbar--logout:hover { background: rgba(239,68,68,0.3); }

/* ── Admin Panel wrap ─────────────────────────────────────── */
.admin-panel-wrap {
  max-width: 1450px; margin: 0 auto;
  background: #fff; border-bottom: 2px solid #e2e8f0;
  padding: 1.25rem 1.5rem;
}

/* ── Toast ────────────────────────────────────────────────── */
.toast-container { position: fixed; top: 4.5rem; right: 1rem; z-index: 9999; display: flex; flex-direction: column; gap: 0.5rem; max-width: 320px; }
.toast-item { padding: 0.75rem 1.25rem; border-radius: 12px; font-weight: 600; font-size: 0.9rem; box-shadow: 0 4px 12px rgba(0,0,0,0.15); color: #fff; animation: slideIn .3s ease-out; }
.toast-success { background: #10b981; }
.toast-error   { background: #ef4444; }
.toast-warning { background: #f59e0b; }
@keyframes slideIn { from { opacity:0; transform:translateX(100%); } to { opacity:1; transform:translateX(0); } }

/* ── Layout ───────────────────────────────────────────────── */
.page-wrap { min-height: 100vh; background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); font-family: system-ui, -apple-system, sans-serif; }
.layout { max-width: 1450px; margin: 0 auto; padding: 1.5rem 1rem; display: flex; flex-direction: column; gap: 1.5rem; }
.control-card, .cases-section { background: #fff; border-radius: 20px; padding: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,.05), 0 2px 4px -1px rgba(0,0,0,.1); border: 1px solid #e2e8f0; }

/* ── Buttons/Toggles ──────────────────────────────────────── */
.toggle-row, .status-toggle-row, .warehouse-toggle-row { display: flex; gap: 0.75rem; margin-bottom: 1rem; }
.toggle-row button, .status-toggle-row button { flex: 1; padding: 0.875rem 1rem; border-radius: 12px; font-size: 1rem; font-weight: 600; transition: all .3s; box-shadow: 0 2px 4px rgba(0,0,0,.08); border: 2px solid #cbd5e1; background: #f1f5f9; color: #475569; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
.toggle-row button:hover, .status-toggle-row button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,.15); }
.warehouse-toggle-row { align-items: center; }
.gear-container { flex-shrink: 0; margin-right: 0.5rem; }
.btn-gear { width: 40px; height: 40px; border-radius: 50%; background: #f3f4f6; border: 1px solid #d1d5db; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; cursor: pointer; transition: all .2s; }
.btn-gear:hover { background: #e5e7eb; transform: scale(1.05); }
.warehouse-buttons { flex: 1; display: flex; gap: 0.5rem; }
.warehouse-buttons button { flex: 1; padding: 0.75rem 1rem; border-radius: 10px; font-weight: 600; transition: all .3s; }

/* ── Control body ─────────────────────────────────────────── */
.control-body { background: #f8f9fa; border-radius: 12px; padding: 1.25rem; border: 1px solid #e5e7eb; }
.control-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; margin-top: 1rem; }
.control-actions input { grid-column: span 3; padding: 0.875rem; font-size: 1rem; }

/* ── Cases ────────────────────────────────────────────────── */
.section-header { margin-bottom: 1.5rem; text-align: center; }
.section-title { font-weight: 800; color: #1e293b; font-size: 1.6rem; margin: 0; letter-spacing: -0.025em; }
.case-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem; }
.case-card { animation: fadeIn .4s ease-out; transition: all .3s; border-radius: 16px; overflow: hidden; }
.case-card:hover { transform: translateY(-4px); box-shadow: 0 10px 25px rgba(0,0,0,.1) !important; }
.card { border: 1px solid #e2e8f0 !important; border-radius: 16px; height: 100%; }
.card-body { padding: 1.5rem; }
.info-content { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; font-size: 1rem; }
.info-content .fw-bold { font-size: 1.1rem; line-height: 1.3; }

/* ── Media grid ───────────────────────────────────────────── */
.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 0.75rem; margin: 1rem 0; }
.media-item { position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; }
.media-item img, .media-item video { width: 100%; height: 100%; object-fit: cover; cursor: pointer; }
.media-del { position: absolute; top: -6px; right: -6px; background: #ef4444; color: #fff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 12px; cursor: pointer; z-index: 10; font-weight: bold; }
.media-add { aspect-ratio: 1; border: 2px dashed #cbd5e0; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #94a3b8; font-size: 24px; transition: all .2s; }
.media-add:hover { border-color: #3b82f6; background: #eff6ff; color: #3b82f6; }

/* ── Date pill ────────────────────────────────────────────── */
.date-pill { background: linear-gradient(135deg, #10b981, #059669); color: #fff; padding: 0.5rem 1rem; border-radius: 20px; font-weight: 600; font-size: 0.9rem; }

/* ── Media modal ──────────────────────────────────────────── */
.media-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.9); display: flex; align-items: center; justify-content: center; z-index: 1000; cursor: pointer; }
.media-modal-content { position: relative; max-width: 95vw; max-height: 95vh; background: #000; border-radius: 12px; overflow: hidden; }
.modal-media { max-width: 100%; max-height: 95vh; object-fit: contain; display: block; }
.modal-close { position: absolute; top: 15px; right: 15px; background: rgba(0,0,0,.5); color: #fff; border: none; font-size: 28px; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; z-index: 10; }
.modal-close:hover { background: rgba(255,0,0,.8); }

/* ── Misc ─────────────────────────────────────────────────── */
.modal-xl { max-width: 1100px; }
.btn-close-white { filter: invert(1); }
.text-danger { color: #ef4444 !important; }
.text-info   { color: #0ea5e9 !important; }
@keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }

/* ── Responsive ───────────────────────────────────────────── */
@media (max-width: 480px) {
  .tab-label { display: none; }
  .status-toggle-row button { font-size: 0.85rem; padding: 0.6rem 0.4rem; }
  .topbar-user { display: none; }
  .modal-dialog { margin: 0.5rem; max-width: calc(100% - 1rem); }
}
@media (max-width: 768px) {
  .layout { padding: 1rem 0.5rem; gap: 1rem; }
  .control-card, .cases-section { padding: 1rem; border-radius: 16px; }
  .toggle-row, .status-toggle-row { gap: 0.5rem; }
  .toggle-row button, .status-toggle-row button { flex: 1; padding: 0.75rem 0.5rem; font-size: 0.85rem; }
  .warehouse-toggle-row { flex-direction: column; align-items: stretch; }
  .warehouse-buttons { flex-direction: row; }
  .control-actions { grid-template-columns: 1fr 1fr; }
  .control-actions input { grid-column: span 2; }
  .case-strip { grid-template-columns: 1fr; }
  .section-title { font-size: 1.25rem; }
  .toast-container { max-width: calc(100vw - 2rem); }
}
@media (min-width: 1200px) {
  .case-strip { grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); }
}
/* ── Stats Panel ──────────────────────────────────────────── */
.stats-wrap { max-width: 1450px; margin: 0 auto; background: #fff; border-bottom: 2px solid #e2e8f0; padding: 1rem 1.5rem; }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 0.75rem; }
.stat-card { border-radius: 14px; padding: 1rem; text-align: center; }
.stat-blue   { background: #dbeafe; }
.stat-yellow { background: #fef3c7; }
.stat-green  { background: #d1fae5; }
.stat-teal   { background: #ccfbf1; }
.stat-num  { font-size: 2rem; font-weight: 800; line-height: 1; }
.stat-blue .stat-num   { color: #1d4ed8; }
.stat-yellow .stat-num { color: #92400e; }
.stat-green .stat-num  { color: #065f46; }
.stat-teal .stat-num   { color: #0f766e; }
.stat-label { font-size: 0.78rem; font-weight: 600; color: #475569; margin-top: 0.25rem; }
.stats-row2 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
.stat-wh { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.65rem 1rem; }
.stat-wh-title { font-weight: 700; font-size: 0.85rem; color: #1e293b; margin-bottom: 0.3rem; }
.stat-wh-row { font-size: 0.8rem; }
.s-blue   { color: #1d4ed8; font-weight: 600; }
.s-yellow { color: #92400e; font-weight: 600; }
.s-green  { color: #065f46; font-weight: 600; }
@media (max-width: 480px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .stats-row2 { grid-template-columns: 1fr; }
}
</style>