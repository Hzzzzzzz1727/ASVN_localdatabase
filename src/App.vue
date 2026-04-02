<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import * as XLSX from 'xlsx'
import { getSupabase } from './lib/supabase'

import { useSupabaseCustomers } from '@/composables/useSupabaseCustomers'
import { useTicketParser } from '@/composables/useTicketParser'
import { useGeocodingAndRouting } from '@/composables/useGeocodingAndRouting'
import { useLinhKienManager } from '@/composables/useLinhKienManager'
import { useAuth } from '@/composables/useAuth'
import { buildShareAdminUrl, copyText, ensureShareRecord } from '@/lib/shareLinks'

import LoginPage from '@/components/LoginPage.vue'
import RevenueChart from '@/components/RevenueChart.vue'
import AdminPanel from '@/components/AdminPanel.vue'

// ── AUTH ──────────────────────────────────────────────────────
const {
  currentUser,
  isLoggedIn, isAdmin, isNhanVien, isAuthLoading,
  userName, userWarehouse, canDelete, canExport,
  initAuth, logout
} = useAuth()

const showAdminPanel = ref(false)
const showStats  = ref(false)
const showChart  = ref(false)
const isOnline = ref(navigator.onLine)
window.addEventListener('online',  () => { isOnline.value = true;  showToast('Đã kết nối lại!', 'success') })
window.addEventListener('offline', () => { isOnline.value = false; showToast('Mất kết nối mạng!', 'error', 0) })

// ── SUPABASE ──────────────────────────────────────────────────
const supabase = getSupabase()
const globalSearchQuery = ref('')
const searchQuery = ref('')
const historySearchQuery = ref('')
const completedDateFrom = ref('')
const completedDateTo = ref('')
const { customers, loadData, hydrateCache, loadMediaForItem, uploadMediaFiles, removeMediaItem, migrateBase64ToStorage } = useSupabaseCustomers()

const ensureSession = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  const expiresInMs = session?.expires_at ? (session.expires_at * 1000) - Date.now() : 0
  if (session && expiresInMs > 5 * 60 * 1000) return session

  const { data, error } = await supabase.auth.refreshSession()
  if (error) throw error
  return data.session || session
}
const withTimeout = (promise, ms = 5000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])

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

// ── MEDIA CACHE ───────────────────────────────────────────────
// Tránh fetch lại media mỗi lần mở modal
const mediaCache = new Map()
const loadMediaCached = async (id) => {
  if (mediaCache.has(id)) return [...mediaCache.get(id)]
  try {
    // Timeout 8s - nếu Supabase không response thì trả về [] thay vì treo
    const media = await Promise.race([
      loadMediaForItem(id),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000))
    ])
    mediaCache.set(id, media)
    return [...media]
  } catch (e) {
    if (e.message === 'timeout') showToast('Load ảnh chậm, thử lại sau', 'warning', 2000)
    return []
  }
}
const invalidateMediaCache = (id) => mediaCache.delete(id)

// Helper: update local customers array (tránh reload toàn bộ)
const updateLocalCustomer = (id, updates) => {
  const idx = customers.value.findIndex(c => c.id === id)
  if (idx !== -1) customers.value[idx] = { ...customers.value[idx], ...updates }
}

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
      else { showToast(`Đã lưu TDP: ${ticketIdTDP} - ${nameTDP}`, 'success'); await loadData() }
      rawInput.value = ''
      return
    }

    // ── Nhánh PSC: format "Số phiếu: ASVN" ──────────────────────
    if (/Số phiếu\s*:/i.test(text) || /\*\s*Họ tên\s*:/i.test(text)) {
      const ticketPSC = text.match(/(?:Số phiếu|số sửa chữa)\s*:\s*(ASVN\d+)/i)?.[1]?.toUpperCase()
        || text.match(/ASVN\d+/)?.[0]?.toUpperCase()
      if (!ticketPSC) { showToast('Không tìm thấy mã ASVN!', 'error'); return }
      const { data: existPSC } = await supabase.from('customers').select('ticketId').eq('ticketId', ticketPSC).maybeSingle()
      if (existPSC) { showToast(`Ca ${ticketPSC} đã tồn tại!`, 'warning'); rawInput.value = ''; return }

      const namePSC = text.match(/\*\s*Họ tên\s*:\s*(.+?)$/im)?.[1]?.trim()
        || text.match(/\bName\s*:\s*(.+?)(?=\s+Phone\s*Number|\s+Address|\n|$)/i)?.[1]?.trim()
        || text.match(/Report\s*person\s*:.*?(?:End\s+user\s+)?((?:Anh|Chị|chị|Bác|bác|Ông|ông|Bà|bà|Chú|chú|Em|em|Cô|cô)\s+[^\s\-,\n(+]+)/i)?.[1]?.trim()
        || 'Khách'
      const rawPhPSC = text.match(/\*\s*Điện thoại\s*:\s*([\+\d]+)/i)?.[1]
        || text.match(/Phone\s*Number\s*:\s*([\+\d]+)/i)?.[1]
        || text.match(/Report\s*person\s*:.*?(?:Anh|Chị|chị|Bác|bác|Ông|ông|Bà|bà|Chú|chú|Em|em|Cô|cô)\s+\S+\s+([\+\d]{9,13})/i)?.[1]
        || ''
      const phonePSC = rawPhPSC.replace(/^\+84/, '0')
      const addrRawPSC = text.match(/\*\s*Địa chỉ\s*:\s*(.+?)(?=\n\s*\*|\n\s*Tên Đại|$)/is)?.[1]
        || text.match(/\bAddress\s*:\s*(.+?)(?=\s*Faulty description|\s*CS handle|$)/is)?.[1] || ''
      const addressPSC = addrRawPSC.replace(/\n/g,' ').replace(/\s+/g,' ').trim().split(/\.\s+/)[0].trim()
      const modelPSC = text.match(/^Model\s*:\s*\n\s*(.+?)$/im)?.[1]?.trim()
        || text.match(/^Model\s*:\s*(.+?)$/im)?.[1]?.trim() || 'Xiaomi TV'
      const serialPSC = text.match(/Số Serial\s*:\s*\n\s*([^\n\s]+)/i)?.[1]
        || text.match(/Số Serial\s*:([^\n\s]+)/i)?.[1]
        || text.match(/(?:SN\s*or\s*IMEI|IMEI\s*\/\s*SN|SN)\s*:\s*([^\s\n]+)/i)?.[1] || ''
      const issuePSC = text.match(/Faulty description\s*:\s*(.+?)(?:\s*CS handle:|\n\n|\nSố phiếu|$)/is)?.[1]?.trim().replace(/\n/g,' ')
        || text.match(/Hiện tượng\s*:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || 'Bảo hành TV'
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
      else { showToast(`Đã lưu ${warehousePSC}: ${ticketPSC} - ${namePSC}`, 'success'); await loadData() }
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

    const nameHoTen  = text.match(/\*\s*Họ tên\s*:\s*(.+?)$/im)
    const nameCust   = text.match(/Customer Name\s*:\s*(.+?)(?:\s+Customer|\n|$)/i)
    const nameReport = text.match(/Report\s*[Pp]erson\s*:.*?(?:End\s+user\s+)?((?:Anh|Ch\u1ecb|ch\u1ecb|B\u00e1c|b\u00e1c|\u00d4ng|\u00f4ng|B\u00e0|b\u00e0|Ch\u00fa|ch\u00fa|Em|em|C\u00f4|c\u00f4)\s+[^\s\-,\n(]+)/i)
    const nameShort  = text.replace(fullTicketId, '').trim().match(/^((?:Anh|Chị|chị|Bác|bác|Ông|ông|Bà|bà|Chú|chú|Em|em|Cô|cô)\s+[^\s,|\n(]+)/)
    const name = (nameHoTen?.[1] || nameCust?.[1] || nameReport?.[1] || nameShort?.[1] || 'Khách NV').trim()

    const phoneLine   = text.match(/\*\s*Điện thoại\s*:\s*([\+\d]+)/i)
    const phoneCust   = text.match(/Customer Phone\s*:\s*([\+\d]+)/i)
    const phoneReport = text.match(/Report\s*[Pp]erson\s*:.*?(?:Anh|Ch\u1ecb|ch\u1ecb|B\u00e1c|b\u00e1c|\u00d4ng|\u00f4ng|B\u00e0|b\u00e0|Ch\u00fa|ch\u00fa|Em|em|C\u00f4|c\u00f4)\s+\S+\s+([\+\d]{9,13})/i)
    const phoneAny    = text.match(/(?<!\d)(?:\+84|0)[3-9][0-9]{8}(?!\d)/)
    const rawPhone    = phoneLine?.[1] || phoneCust?.[1] || phoneReport?.[1] || phoneAny?.[0] || ''
    const phone = rawPhone.replace(/^\+84/, '0')

    const addrFull  = text.match(/\*\s*Địa chỉ\s*:\s*(.+?)(?=\n\s*\*|\n\s*Điện thoại|\n\s*Tên|\n\s*Mail|$)/is)
    const addrCu    = text.match(/[Aa]d+ress\s*:.*?(?:\+\s*c[uũ]\s*:)?\s*(.+?)(?:\s*-\s*Faulty|\s*-\s*CS\s*handle|$)/is)
    const addrCust  = text.match(/Customer [Aa]d+ress\s*:\s*(.+?)(?:\n|$)/i)
    const addrCity  = text.match(/([^\n]+?(?:Quảng Nam|Đà Nẵng|QUẢNG NAM|ĐÀ NẴNG|tỉnh|Huyện)[^\n]*)/i)
    const rawAddr   = addrFull?.[1] || addrCu?.[1] || addrCust?.[1] || addrCity?.[1] || 'Chưa bóc được địa chỉ'
    const address   = rawAddr.replace(/^\+?\s*c[uũ]\s*:\s*/i, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()

    const modelInline = text.match(/-\s*Model\s*:\s*(.+?)(?:\s*-\s*SN|\s*-\s*Adress|\s*-\s*Faulty|\n|$)/i)
    const modelDesc   = text.match(/Model\s*:\s*(Xiaomi[^\n\r\-]+?)(?:\n|SN:|$)/i)
    const modelLine   = text.match(/^[Mm]odel\s*:\s*(.+?)$/im)
    const model = (modelInline?.[1] || modelDesc?.[1] || modelLine?.[1] || 'Xiaomi TV').trim()

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
    else { showToast(`Đã lưu: ${fullTicketId} - ${name}`, 'success'); await loadData() }
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
const currentType      = ref('ASVN')
const showWarehouse    = ref(true)
const currentWarehouse = ref('TDP')
const isEditingLink    = ref({})
const tempFolderLink   = ref({})
const showTab          = ref('danglam')
const outsideTab       = ref('danglam')
const showFilters      = ref(false)
const showQuickCreateModal = ref(false)
const detailModalTab   = ref('info')
const outsideModalTab  = ref('info')
const detailStatusDraft = ref(0)
const outsideStatusDraft = ref(0)
const isStatusActionLoading = ref(false)
const isMobileControlCollapsed = ref(false)
const sortOption = ref('newest')
const createdDateFilter = ref('all')
const partSearchQuery = ref('')
const isCustomerMediaLoading = ref(false)
const isOutsideMediaLoading = ref(false)
const confirmDialog = ref({
  visible: false,
  title: 'Xác nhận',
  message: '',
  confirmText: 'Đồng ý',
  cancelText: 'Hủy',
  variant: 'primary',
  resolve: null,
})

const isMobileViewport = () => window.innerWidth <= 768
const assignedWarehouse = computed(() => {
  const warehouse = typeof userWarehouse.value === 'string'
    ? userWarehouse.value.trim().toUpperCase()
    : ''
  return warehouse || null
})
const hasLockedWarehouse = computed(() => isNhanVien.value && !!assignedWarehouse.value)
const availableWarehouses = computed(() => hasLockedWarehouse.value ? [assignedWarehouse.value] : ['TDP', 'NV'])
const syncWarehouseByRole = () => {
  if (hasLockedWarehouse.value) {
    currentWarehouse.value = assignedWarehouse.value
    showWarehouse.value = true
    return
  }
  if (!availableWarehouses.value.includes(currentWarehouse.value)) {
    currentWarehouse.value = 'TDP'
  }
}
watch([isNhanVien, assignedWarehouse], () => {
  syncWarehouseByRole()
}, { immediate: true })
const syncMobileControlForViewport = () => {
  if (!isMobileViewport()) {
    isMobileControlCollapsed.value = false
  }
}
const expandMobileControlCard = () => {
  if (!isMobileViewport() || !isMobileControlCollapsed.value) return
  isMobileControlCollapsed.value = false
}
const toggleFilterPanel = () => {
  if (isMobileViewport() && isMobileControlCollapsed.value) {
    isMobileControlCollapsed.value = false
    showFilters.value = true
    return
  }
  showFilters.value = !showFilters.value
}
const collapseMobileControlCard = () => {
  if (!isMobileViewport()) return
  isMobileControlCollapsed.value = true
}

// ── EDIT CA ───────────────────────────────────────────────────
const showEditModal   = ref(false)
const editingCa       = ref(null)  // bản copy đang edit
const editingCaSource = ref('')    // 'asvn' | 'outside'

const openEditModal = (customer, source = 'asvn') => {
  editingCa.value = {
    id: customer.id,
    name: customer.name || '',
    phone: customer.phone || '',
    model: customer.model || '',
    address: customer.address || '',
    issue: customer.issue || '',
    note: customer.note || '',
    serial: customer.serial || '',
    branch: customer.branch || '',
    warehouse: customer.warehouse || '',
  }
  editingCaSource.value = source
  showEditModal.value = true
}
const closeEditModal = () => { showEditModal.value = false; editingCa.value = null }

const saveEditCa = async () => {
  if (!editingCa.value) return
  const { id, ...fields } = editingCa.value
  const { error } = await supabase.from('customers').update(fields).eq('id', id)
  if (error) { showToast('Lỗi cập nhật: ' + error.message, 'error'); return }
  // Cập nhật local
  updateLocalCustomer(id, fields)
  // Cập nhật modal đang mở
  if (showDetailModal.value && selectedCustomer.value?.id === id)
    selectedCustomer.value = { ...selectedCustomer.value, ...fields }
  if (showOutsideDetailModal.value && selectedOutside.value?.id === id)
    selectedOutside.value = { ...selectedOutside.value, ...fields }
  showToast('Đã cập nhật ca!', 'success')
  closeEditModal()
}

// ── GIÁ TIỀN & LINH KIỆN ─────────────────────────────────────
const editingPrice   = ref(0)
const editingLkItems = ref([])
const newLkName      = ref('')
const newLkPrice     = ref(0)
const showLkForm     = ref(false)

const formatPrice = (n) => {
  if (!n) return '0đ'
  return Number(n).toLocaleString('vi-VN') + 'đ'
}
const totalLkPrice = (items) => (items || []).reduce((s, i) => s + (Number(i.price) || 0), 0)

const openPriceEditor = (customer) => {
  editingPrice.value = customer.price || 0
  editingLkItems.value = JSON.parse(JSON.stringify(customer.lkItems || []))
  showLkForm.value = true
}
const addLkItem = () => {
  if (!newLkName.value.trim()) return
  editingLkItems.value.push({ name: newLkName.value.trim(), price: Number(newLkPrice.value) || 0 })
  newLkName.value = ''
  newLkPrice.value = 0
}
const removeLkItem = (idx) => editingLkItems.value.splice(idx, 1)

const savePriceAndLk = async (customer) => {
  if (!customer) return
  await ensureSession()
  const autoPrice = totalLkPrice(editingLkItems.value)
  const finalPrice = editingPrice.value || autoPrice
  // Tự tổng hợp tên linh kiện vào replacedPart để giữ tương thích Excel + hiển thị card
  const partSummary = editingLkItems.value.length
    ? editingLkItems.value.map(lk => lk.name).join(', ')
    : customer.replacedPart || 'Chưa có'
  const updates = { price: finalPrice, lkItems: editingLkItems.value, replacedPart: partSummary }
  await supabase.from('customers').update(updates).eq('id', customer.id)
  updateLocalCustomer(customer.id, updates)
  if (selectedCustomer.value?.id === customer.id)
    selectedCustomer.value = { ...selectedCustomer.value, ...updates }
  if (selectedOutside.value?.id === customer.id)
    selectedOutside.value = { ...selectedOutside.value, ...updates }
  showLkForm.value = false
  showToast('Đã lưu giá tiền!', 'success')
}

// ── MODALS ────────────────────────────────────────────────────
const showDetailModal        = ref(false)
const selectedCustomer       = ref(null)
const editingPart2           = ref('')
const showModal              = ref(false)
const modalMedia             = ref(null)
const showTreModal           = ref(false)
const showChoLkTreModal      = ref(false)
const showOutsideForm        = ref(false)
const outsideForm            = ref({ name: '', phone: '', brand: '', model: '', issue: '', note: '' })
const outsideRawInput        = ref('')

const parseOutsideText = () => {
  const text = outsideRawInput.value.trim()
  if (!text) return

  // Tìm SĐT
  const phoneMatch = text.match(/(?:\+84|0)[3-9][0-9]{8}/)
  const phone = phoneMatch ? phoneMatch[0].replace(/^\+84/, '0') : ''

  // Tìm tên (Anh/Chị + tên, ở đầu chuỗi hoặc trước SĐT)
  const nameMatch = text.match(/^((?:Anh|Chị|chị|Bác|bác|Ông|ông|Bà|bà|Chú|chú|Em|em|Cô|cô)\s+[^\d]+?)(?=\s*(?:\+84|0)[3-9])/)
    || text.match(/((?:Anh|Chị|chị|Bác|bác|Ông|ông|Bà|bà|Chú|chú|Em|em|Cô|cô)\s+\S+)/)
  const name = nameMatch ? nameMatch[1].trim() : ''

  // Tìm hãng TV
  const brandMatch = text.match(/\b(Samsung|LG|Sony|Panasonic|Sharp|Toshiba|TCL|Hisense|Xiaomi|Philips|Coocaa|Skyworth|Asanzo|Casper|Vsmart)\b/i)
  const brand = brandMatch ? brandMatch[1] : ''

  // Tìm model (chuỗi số-chữ trông giống model TV)
  const textNoPhone = text.replace(phoneMatch?.[0] || '', '')
  const modelMatch = textNoPhone.match(/\b([A-Z0-9]{3,}[A-Z0-9\-]*(?:[a-z]+)?[0-9]*)\b/i)
  const model = modelMatch ? modelMatch[1] : ''

  // Phần còn lại sau khi bỏ tên, SĐT, hãng, model → issue
  let issue = text
  if (name) issue = issue.replace(name, '')
  if (phone) issue = issue.replace(phoneMatch[0], '')
  if (brand) issue = issue.replace(new RegExp(brand, 'i'), '')
  if (model) issue = issue.replace(model, '')
  issue = issue.replace(/\b(tivi|tv|màn hình|máy)\b/gi, '').replace(/\s+/g, ' ').trim()
  // Lấy phần lỗi sau từ "lỗi" nếu có
  const loiMatch = outsideRawInput.value.match(/lỗi\s+(.+)/i)
  if (loiMatch) issue = loiMatch[1].trim()

  outsideForm.value = {
    name: name || outsideForm.value.name,
    phone: phone || outsideForm.value.phone,
    brand: brand || outsideForm.value.brand,
    model: model || outsideForm.value.model,
    issue: issue || outsideForm.value.issue,
  }
}
const showOutsideDetailModal = ref(false)
const selectedOutside        = ref(null)
const editingOutsidePart     = ref('')
const showWarrantyOptions    = ref(false)
const showCustomWarrantyInput = ref(false)
const customWarrantyMonths   = ref('')

// ── MODAL HANDLERS ────────────────────────────────────────────
const openDetailModalFull = (customer) => {
  detailModalTab.value = 'info'
  detailStatusDraft.value = customer.status ?? 0
  isCustomerMediaLoading.value = true
  selectedCustomer.value = { ...customer, media: [] }
  editingPart2.value = customer.replacedPart || ''
  showDetailModal.value = true
  document.body.style.overflow = 'hidden'
  // Load ảnh hoàn toàn nền - không block modal
  loadMediaCached(customer.id).then(media => {
    if (!selectedCustomer.value || selectedCustomer.value.id !== customer.id) return
    selectedCustomer.value = { ...selectedCustomer.value, media }
    // Migrate base64 cũ sang Storage ngầm
    if (media.some(m => m.source === 'local' || (!m.source && m.data?.startsWith('data:')))) {
      migrateBase64ToStorage(customer.id, media).then(migrated => {
        mediaCache.set(customer.id, migrated)
        if (selectedCustomer.value?.id === customer.id)
          selectedCustomer.value = { ...selectedCustomer.value, media: migrated }
      })
    }
  }).finally(() => {
    if (selectedCustomer.value?.id === customer.id) isCustomerMediaLoading.value = false
  })
}
const closeDetailModal = () => {
  isCustomerMediaLoading.value = false
  showDetailModal.value = false; selectedCustomer.value = null; document.body.style.overflow = ''
}

const openOutsideDetailModal = (item) => {
  outsideModalTab.value = 'info'
  outsideStatusDraft.value = item.status ?? 0
  showWarrantyOptions.value = false
  showCustomWarrantyInput.value = false
  customWarrantyMonths.value = ''
  isOutsideMediaLoading.value = true
  selectedOutside.value = { ...item, media: [] }
  editingOutsidePart.value = item.replacedPart || ''
  showOutsideDetailModal.value = true
  document.body.style.overflow = 'hidden'
  loadMediaCached(item.id).then(media => {
    if (!selectedOutside.value || selectedOutside.value.id !== item.id) return
    selectedOutside.value = { ...selectedOutside.value, media }
    if (media.some(m => m.source === 'local' || (!m.source && m.data?.startsWith('data:')))) {
      migrateBase64ToStorage(item.id, media).then(migrated => {
        mediaCache.set(item.id, migrated)
        if (selectedOutside.value?.id === item.id)
          selectedOutside.value = { ...selectedOutside.value, media: migrated }
      })
    }
  }).finally(() => {
    if (selectedOutside.value?.id === item.id) isOutsideMediaLoading.value = false
  })
}
const closeOutsideDetailModal = () => {
  showWarrantyOptions.value = false
  showCustomWarrantyInput.value = false
  customWarrantyMonths.value = ''
  isOutsideMediaLoading.value = false
  showOutsideDetailModal.value = false; selectedOutside.value = null; document.body.style.overflow = ''
}

const openTreModal    = () => showTreModal.value = true
const closeTreModal   = () => showTreModal.value = false
const openQuickCreateModal = () => { showQuickCreateModal.value = true }
const closeQuickCreateModal = () => { showQuickCreateModal.value = false }
const openCreateCaseModal = () => {
  if (currentType.value === 'OUTSIDE') openOutsideForm()
  else openQuickCreateModal()
}
const openMediaModal  = (media) => { modalMedia.value = media; showModal.value = true; document.body.style.overflow = 'hidden' }
const closeMediaModal = () => { showModal.value = false; modalMedia.value = null; document.body.style.overflow = '' }
const openCustomerFromSearch = (item) => {
  if (item.ticketId?.startsWith('NGOAI')) openOutsideDetailModal(item)
  else openDetailModalFull(item)
}
watch(showPartModal, (visible) => {
  if (!visible) partSearchQuery.value = ''
})

// ── NAVIGATION ────────────────────────────────────────────────
const backToTypeToggle = () => { showWarehouse.value = false; currentType.value = 'ASVN' }
const selectWarehouse  = (wh) => {
  if (hasLockedWarehouse.value) {
    currentWarehouse.value = assignedWarehouse.value
    searchQuery.value = ''
    globalSearchQuery.value = ''
    return
  }
  currentWarehouse.value = wh; searchQuery.value = ''; globalSearchQuery.value = ''
}
const selectType = (type) => {
  currentType.value = type; showTab.value = 'danglam'; outsideTab.value = 'danglam'
  searchQuery.value = ''; historySearchQuery.value = ''; globalSearchQuery.value = ''
  completedDateFrom.value = ''; completedDateTo.value = ''
  createdDateFilter.value = 'all'
  if (type === 'ASVN') {
    showWarehouse.value = true
    syncWarehouseByRole()
  }
}

// ── THỐNG KÊ ─────────────────────────────────────────────────
const stats = computed(() => {
  const asvn = customers.value.filter(c => c.ticketId?.startsWith('ASVN'))
  const tdp  = asvn.filter(c => c.warehouse === 'TDP')
  const nv   = asvn.filter(c => c.warehouse === 'NV')
  const today = new Date().toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' })
  return {
    tongTat:        asvn.filter(c => c.status === 2).length,
    dangLamAll:     asvn.filter(c => c.status === 0).length,
    choLKAll:       asvn.filter(c => c.status === 1).length,
    tdpDangLam:     tdp.filter(c => c.status === 0).length,
    tdpChoLK:       tdp.filter(c => c.status === 1).length,
    tdpXong:        tdp.filter(c => c.status === 2).length,
    nvDangLam:      nv.filter(c => c.status === 0).length,
    nvChoLK:        nv.filter(c => c.status === 1).length,
    nvXong:         nv.filter(c => c.status === 2).length,
    hoanThanhHomNay: asvn.filter(c => c.status === 2 && c.doneDate === today).length,
    csvnTong:       customers.value.filter(c => c.ticketId?.startsWith('CSVN')).length,
    ngoaiTong:      customers.value.filter(c => c.ticketId?.startsWith('NGOAI')).length,
    doanhThuHomNay: asvn.filter(c => c.status === 2 && c.doneDate === today).reduce((s,c) => s + (c.price||0), 0),
    doanhThuThang:  asvn.filter(c => c.status === 2 && c.doneDate?.endsWith(`/${new Date().getMonth()+1}/${new Date().getFullYear()}`)).reduce((s,c) => s + (c.price||0), 0),
    choLkTre:       asvn.filter(c => c.status === 1 && c.statusLog?.length && (() => { const last = [...c.statusLog].reverse().find(l=>l.status===1); if (!last) return false; const d = last.at?.match(/(\d+)\/(\d+)\/(\d+)/); if (!d) return false; const t = new Date(d[3],d[2]-1,d[1]); return Date.now()-t.getTime() > 3*86400000 })()).length,
  }
})

// ── COMPUTED ──────────────────────────────────────────────────
const getComparableDate = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
const getStatusLabel = (status) => STATUS_LABEL[status] || 'Không rõ'
const getTypeLabel = (ticketId = '') => (
  ticketId.startsWith('ASVN') ? 'ASVN'
    : ticketId.startsWith('CSVN') ? 'CSVN'
      : ticketId.startsWith('NGOAI') ? 'Ca ngoài'
        : 'Khác'
)
const accessScopedCustomers = computed(() => (
  customers.value.filter((item) => {
    if (!hasLockedWarehouse.value) return true
    if (!item.ticketId?.startsWith('ASVN')) return true
    return item.warehouse === assignedWarehouse.value
  })
))
const globalSearchResults = computed(() => {
  const q = globalSearchQuery.value.trim().toLowerCase()
  if (!q) return []
  return accessScopedCustomers.value
    .filter((c) =>
      c.name?.toLowerCase().includes(q) || c.phone?.includes(q) ||
      c.ticketId?.toLowerCase().includes(q) || c.model?.toLowerCase().includes(q) ||
      c.replacedPart?.toLowerCase().includes(q) || c.serial?.toLowerCase().includes(q) ||
      c.issue?.toLowerCase().includes(q) || c.note?.toLowerCase().includes(q)
    )
    .sort((a, b) => {
      const aTime = getComparableDate(a.createdAt)?.getTime() || 0
      const bTime = getComparableDate(b.createdAt)?.getTime() || 0
      return bTime - aTime
    })
})
const isGlobalSearchActive = computed(() => !!globalSearchQuery.value.trim())
const filteredCustomers = computed(() => {
  let f = customers.value
  if (currentType.value === 'ASVN')         f = f.filter(c => c.ticketId?.startsWith('ASVN'))
  else if (currentType.value === 'CSVN')    f = f.filter(c => c.ticketId?.startsWith('CSVN'))
  else if (currentType.value === 'OUTSIDE') f = f.filter(c => c.ticketId?.startsWith('NGOAI'))
  const hasAnyKeyword = !!searchQuery.value.trim() || !!historySearchQuery.value.trim()
  if (currentType.value === 'ASVN') {
    if (hasLockedWarehouse.value) {
      f = f.filter(c => c.warehouse === assignedWarehouse.value)
    } else if (showWarehouse.value && !hasAnyKeyword) {
      f = f.filter(c => c.warehouse === currentWarehouse.value)
    }
  }
  const q = searchQuery.value.toLowerCase()
  if (!q) return f
  return f.filter(c =>
    c.name?.toLowerCase().includes(q) || c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) || c.model?.toLowerCase().includes(q) ||
    c.replacedPart?.toLowerCase().includes(q) || c.serial?.toLowerCase().includes(q)
  )
})

const parseDoneDateValue = (value) => {
  if (!value || typeof value !== 'string') return null
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null
  const [, dd, mm, yyyy] = match
  return `${yyyy}-${mm}-${dd}`
}
const matchesCreatedDateFilter = (item) => {
  if (createdDateFilter.value === 'all') return true
  const createdAt = getComparableDate(item.createdAt)
  if (!createdAt) return false
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (createdDateFilter.value === 'today') return createdAt >= todayStart
  if (createdDateFilter.value === 'week') {
    const weekday = todayStart.getDay()
    const diff = weekday === 0 ? 6 : weekday - 1
    const weekStart = new Date(todayStart)
    weekStart.setDate(todayStart.getDate() - diff)
    return createdAt >= weekStart
  }
  return true
}
const sortItems = (items, dateField = 'createdAt') => {
  const list = [...items]
  if (sortOption.value === 'warehouse') {
    return list.sort((a, b) => {
      const warehouseOrder = { TDP: 0, NV: 1 }
      const warehouseDiff = (warehouseOrder[a.warehouse] ?? 99) - (warehouseOrder[b.warehouse] ?? 99)
      if (warehouseDiff !== 0) return warehouseDiff
      const aTime = getComparableDate(a[dateField])?.getTime() || 0
      const bTime = getComparableDate(b[dateField])?.getTime() || 0
      return bTime - aTime
    })
  }
  const direction = sortOption.value === 'oldest' ? 1 : -1
  return list.sort((a, b) => {
    const aTime = getComparableDate(a[dateField])?.getTime() || 0
    const bTime = getComparableDate(b[dateField])?.getTime() || 0
    return (aTime - bTime) * direction
  })
}
const dangLam     = computed(() => sortItems(filteredCustomers.value.filter(c => c.status === 0).filter(matchesCreatedDateFilter)))
const choLinhKien = computed(() => sortItems(filteredCustomers.value.filter(c => c.status === 1)))
const hoanThanh   = computed(() => {
  const q = historySearchQuery.value.toLowerCase()
  let items = filteredCustomers.value.filter(c => c.status === 2)
  if (completedDateFrom.value) {
    items = items.filter(c => {
      const doneDate = parseDoneDateValue(c.doneDate)
      return doneDate && doneDate >= completedDateFrom.value
    })
  }
  if (completedDateTo.value) {
    items = items.filter(c => {
      const doneDate = parseDoneDateValue(c.doneDate)
      return doneDate && doneDate <= completedDateTo.value
    })
  }
  if (q) items = items.filter(c =>
    c.name?.toLowerCase().includes(q) || c.phone?.includes(q) ||
    c.ticketId?.toLowerCase().includes(q) || c.model?.toLowerCase().includes(q) ||
    c.replacedPart?.toLowerCase().includes(q)
  )
  items = sortItems(items, 'createdAt')
  const groups = {}
  items.forEach(item => { const d = item.doneDate || 'N/A'; if (!groups[d]) groups[d] = []; groups[d].push(item) })
  const orderedEntries = Object.entries(groups).sort((a, b) => {
    const aKey = parseDoneDateValue(a[0])
    const bKey = parseDoneDateValue(b[0])
    if (!aKey && !bKey) return 0
    if (!aKey) return 1
    if (!bKey) return -1
    if (sortOption.value === 'oldest') return aKey.localeCompare(bKey)
    return bKey.localeCompare(aKey)
  })
  return Object.fromEntries(orderedEntries)
})
const outsideDangLam     = computed(() => sortItems(filteredCustomers.value.filter(c => c.status === 0).filter(matchesCreatedDateFilter)))
const outsideChoLinhKien = computed(() => sortItems(filteredCustomers.value.filter(c => c.status === 1)))
const outsideHoanThanh   = computed(() => {
  let items = filteredCustomers.value.filter(c => c.status === 2)
  if (completedDateFrom.value) {
    items = items.filter(c => {
      const doneDate = parseDoneDateValue(c.doneDate)
      return doneDate && doneDate >= completedDateFrom.value
    })
  }
  if (completedDateTo.value) {
    items = items.filter(c => {
      const doneDate = parseDoneDateValue(c.doneDate)
      return doneDate && doneDate <= completedDateTo.value
    })
  }
  return sortItems(items, 'createdAt')
})
// Ca chờ LK trễ > 3 ngày
const choLkTreList = computed(() => {
  return customers.value.filter(c => {
    if (c.status !== 1) return false
    const last = c.statusLog ? [...c.statusLog].reverse().find(l => l.status === 1) : null
    if (!last) return false
    const m = last.at?.match(/(\d+)\/(\d+)\/(\d+)/)
    if (!m) return false
    const t = new Date(m[3], m[2]-1, m[1])
    return Date.now() - t.getTime() > 3 * 86400000
  })
})

const treCaList = computed(() => {
  const now = Date.now()
  return filteredCustomers.value.filter(c => c.status === 0 && c.createdAt && now - new Date(c.createdAt).getTime() > 86400000)
})

const getWarehouseLabel     = (item) => item.warehouse === 'TDP' ? 'Kho TDP' : item.warehouse === 'NV' ? 'Kho NV' : ''
const getWarehouseBadgeClass = (wh) => wh === 'TDP' ? 'warehouse-badge warehouse-badge--tdp' : 'warehouse-badge warehouse-badge--nv'
const filteredLinhKienList = computed(() => {
  const q = partSearchQuery.value.trim().toLowerCase()
  if (!q) return linhKienList.value
  return linhKienList.value.filter((part) => part.toLowerCase().includes(q))
})

// ── CA NGOÀI ──────────────────────────────────────────────────
const openOutsideForm  = () => { showOutsideForm.value = true; outsideForm.value = { name: '', phone: '', brand: '', model: '', issue: '', note: '' }; outsideRawInput.value = '' }
const closeOutsideForm = () => { showOutsideForm.value = false; outsideRawInput.value = '' }
const normalizeModelForCompare = (value) => {
  const normalized = (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (!normalized || normalized === 'chưa rõ') return ''
  return normalized
}
const saveOutsideCa = async () => {
  if (!outsideForm.value.phone || !outsideForm.value.issue) { showToast('Vui lòng nhập SĐT và tình trạng TV!', 'error'); return }
  const phone = outsideForm.value.phone.trim()
  const normalizedNewModel = normalizeModelForCompare(`${outsideForm.value.brand} ${outsideForm.value.model}`.trim())
  const matchedByPhone = customers.value.filter((c) =>
    c.ticketId?.startsWith('NGOAI') && (c.phone || '').trim() === phone
  )

  if (matchedByPhone.length) {
    const matchedByModel = matchedByPhone.find((c) => {
      const existingModel = normalizeModelForCompare(c.model)
      if (!existingModel) return false
      return existingModel === normalizedNewModel
    })

    if (matchedByModel) {
      const warranty = getWarrantyInfo(matchedByModel)
      if (warranty?.expired === false) {
        showToast(
          `Khách này đã có ca ${matchedByModel.ticketId}, model ${matchedByModel.model || 'Chưa rõ'}, còn bảo hành ${warranty.remainingText.replace(/^Còn\s+/i, '').toLowerCase()}. Không cần tạo ca mới.`,
          'warning',
          5000
        )
        return
      }

      if (warranty?.expired) {
        showToast(
          `Khách này đã sửa TV này trước đây ${matchedByModel.ticketId}, bảo hành đã hết. Tạo ca mới và tính phí.`,
          'warning',
          4500
        )
      }
    }
  }

  const now = new Date()
  const ticketId = `NGOAI-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`
  const newCa = {
    ticketId, name: outsideForm.value.name.trim() || 'Khách ngoài',
    phone,
    model: `${outsideForm.value.brand} ${outsideForm.value.model}`.trim() || 'Chưa rõ',
    address: 'Ca ngoài - không có địa chỉ', issue: outsideForm.value.issue,
    media: [], folderDrive: '', status: 0, replacedPart: 'Chưa có linh kiện thay',
    note: outsideForm.value.note?.trim() || '',
    doneDate: null, createdAt: now.toISOString(), warehouse: 'TDP',
    warranty_months: null, warranty_start_at: null, warranty_expires_at: null
  }
  const { error } = await supabase.from('customers').insert([newCa])
  if (error) { showToast('Lỗi lưu ca ngoài: ' + error.message, 'error'); return }
  showToast('Đã nhận ca ngoài! Mã: ' + ticketId, 'success')
  closeOutsideForm(); loadData()
}

// ── TRẠNG THÁI ────────────────────────────────────────────────
const hoanTatKiemTra = async (item, event) => {
  const confirmed = await openConfirmDialog({
    title: 'Chuyển trạng thái',
    message: `Chuyển ca ${item.ticketId} sang "Chờ linh kiện"?`,
    confirmText: 'Chuyển',
    variant: 'warning',
  })
  if (!confirmed) { event.target.checked = false; return }
  await ensureSession()
  await supabase.from('customers').update({ status: 1 }).eq('id', item.id)
  updateLocalCustomer(item.id, { status: 1 })
  showToast('Đã chuyển sang chờ linh kiện!', 'success')
}
const dongCa = async (item) => {
  const confirmed = await openConfirmDialog({
    title: 'Chốt hoàn thành',
    message: `Chốt hoàn thành ca ${item.ticketId}?`,
    confirmText: 'Chốt ca',
    variant: 'success',
  })
  if (!confirmed) return
  await ensureSession()
  const now = new Date()
  const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`
  await supabase.from('customers').update({ status: 2, doneDate: dateStr }).eq('id', item.id)
  updateLocalCustomer(item.id, { status: 2, doneDate: dateStr })
  showToast('Đã chốt ca hoàn thành!', 'success')
}
const revertToDangLam = async (item) => {
  const updates = { status: 0, doneDate: null, price: 0, lkItems: [], replacedPart: 'Chưa có' }
  await supabase.from('customers').update(updates).eq('id', item.id)
  updateLocalCustomer(item.id, updates)
  if (selectedCustomer.value?.id === item.id)
    selectedCustomer.value = { ...selectedCustomer.value, ...updates }
  if (showDetailModal.value) closeDetailModal()
  showToast('Đã hoàn lại trạng thái đang làm!', 'warning')
}
const STATUS_LABEL = { 0: 'Đang làm', 1: 'Chờ linh kiện', 2: 'Hoàn thành' }
const appendStatusLog = (existingLog, status) => {
  const log = Array.isArray(existingLog) ? [...existingLog] : []
  const now = new Date()
  log.push({
    status,
    label: STATUS_LABEL[status],
    by: userName.value || 'Unknown',
    at: now.toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
  })
  return log
}

const changeStatus = async (status) => {
  if (!selectedCustomer.value) return
  if (isStatusActionLoading.value) return
  isStatusActionLoading.value = true
  try {
    await ensureSession()
    const now = new Date()
    const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`
    const newLog = appendStatusLog(selectedCustomer.value.statusLog, status)
    const updates = status === 2 ? { status, doneDate: dateStr, statusLog: newLog } : { status, doneDate: null, statusLog: newLog }
    const { error } = await supabase.from('customers').update(updates).eq('id', selectedCustomer.value.id)
    if (error) throw error
    selectedCustomer.value = { ...selectedCustomer.value, ...updates }
    detailStatusDraft.value = status
    updateLocalCustomer(selectedCustomer.value.id, updates)
    showToast('Đã cập nhật trạng thái!', 'success')
  } catch (e) {
    showToast('Không thể cập nhật trạng thái: ' + (e?.message || 'Unknown error'), 'error')
  } finally {
    isStatusActionLoading.value = false
  }
}
const changeOutsideStatus = async (status) => {
  if (!selectedOutside.value) return
  if (isStatusActionLoading.value) return
  isStatusActionLoading.value = true
  try {
    await ensureSession()
    const now = new Date()
    const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`
    const newLog = appendStatusLog(selectedOutside.value.statusLog, status)
    const updates = status === 2 ? { status, doneDate: dateStr, statusLog: newLog } : { status, doneDate: null, statusLog: newLog }
    const { error } = await supabase.from('customers').update(updates).eq('id', selectedOutside.value.id)
    if (error) throw error
    selectedOutside.value = { ...selectedOutside.value, ...updates }
    outsideStatusDraft.value = status
    updateLocalCustomer(selectedOutside.value.id, updates)
    showToast('Đã cập nhật trạng thái!', 'success')
  } catch (e) {
    showToast('Không thể đổi trạng thái ca ngoài: ' + (e?.message || 'Unknown error'), 'error')
  } finally {
    isStatusActionLoading.value = false
  }
}
const applyDetailStatus = async () => {
  await changeStatus(Number(detailStatusDraft.value))
}
const applyOutsideStatus = async () => {
  await changeOutsideStatus(Number(outsideStatusDraft.value))
}
const savePartInModal = async () => {
  if (!selectedCustomer.value) return
  await ensureSession()
  await supabase.from('customers').update({ replacedPart: editingPart2.value }).eq('id', selectedCustomer.value.id)
  selectedCustomer.value.replacedPart = editingPart2.value
  updateLocalCustomer(selectedCustomer.value.id, { replacedPart: editingPart2.value })
  showToast('Đã lưu linh kiện!', 'success')
}
const saveOutsidePart = async () => {
  if (!selectedOutside.value) return
  await supabase.from('customers').update({ replacedPart: editingOutsidePart.value }).eq('id', selectedOutside.value.id)
  selectedOutside.value.replacedPart = editingOutsidePart.value
  updateLocalCustomer(selectedOutside.value.id, { replacedPart: editingOutsidePart.value })
  showToast('Đã lưu linh kiện!', 'success')
}

// ── XÓA CA (chỉ admin) ───────────────────────────────────────
const saveOutsideNote = async () => {
  if (!selectedOutside.value) return
  const updates = { note: selectedOutside.value.note || '' }
  const { error } = await supabase.from('customers').update(updates).eq('id', selectedOutside.value.id)
  if (error) {
    showToast('Không lưu được ghi chú: ' + error.message, 'error')
    return
  }
  updateLocalCustomer(selectedOutside.value.id, updates)
  selectedOutside.value = { ...selectedOutside.value, ...updates }
  showToast('Đã lưu ghi chú ca ngoài!', 'success')
}
const saveCustomerNote = async () => {
  if (!selectedCustomer.value) return
  const updates = { note: selectedCustomer.value.note || '' }
  const { error } = await supabase.from('customers').update(updates).eq('id', selectedCustomer.value.id)
  if (error) {
    showToast('Không lưu được ghi chú: ' + error.message, 'error')
    return
  }
  updateLocalCustomer(selectedCustomer.value.id, updates)
  selectedCustomer.value = { ...selectedCustomer.value, ...updates }
  showToast('Đã lưu ghi chú ca ASVN!', 'success')
}

const deleteCustomer = async (id) => {
  if (!canDelete.value) { showToast('Bạn không có quyền xóa ca!', 'error'); return }
  const item = customers.value.find(c => c.id === id)
  if (!item) return showToast('Ca không tồn tại!', 'error')
  const msg = (showWarehouse.value && currentType.value === 'ASVN' && item.warehouse && item.warehouse !== currentWarehouse.value)
    ? `Ca này thuộc kho ${item.warehouse}, bạn có chắc xóa?`
    : 'Bạn có chắc chắn muốn xóa ca này?'
  const confirmed = await openConfirmDialog({
    title: 'Xóa ca',
    message: msg,
    confirmText: 'Xóa',
    variant: 'danger',
  })
  if (!confirmed) return
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) showToast('Lỗi xóa: ' + error.message, 'error')
  else {
    showToast('Đã xóa ca thành công!', 'success')
    // Xóa local ngay, không cần reload toàn bộ
    customers.value = customers.value.filter(c => c.id !== id)
    invalidateMediaCache(id)
  }
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
const normalizeMediaForDb = (media) => (media || []).map((m) => {
  if (!m) return null
  if (m.source === 'storage' && m.path) {
    return { type: m.type || 'image', source: 'storage', path: m.path }
  }
  if (m.source === 'drive') {
    return {
      type: m.type || 'image',
      source: 'drive',
      data: m.data,
      ...(m.original ? { original: m.original } : {})
    }
  }
  if (m.data) {
    return {
      type: m.type || 'image',
      data: m.data,
      ...(m.source ? { source: m.source } : {})
    }
  }
  return m
}).filter(Boolean)
const onFileChange = async (e, item) => {
  const input = e.target
  const files = Array.from(input?.files || [])
  if (!files.length) return
  try {
    await ensureSession()
    const currentMedia = await loadMediaCached(item.id)
    const updated = await uploadMediaFiles(files, item.id, currentMedia)
    const mediaForDb = normalizeMediaForDb(updated)
    const { error } = await supabase.from('customers').update({ media: mediaForDb }).eq('id', item.id)
    if (error) throw error
    mediaCache.set(item.id, updated)
    updateLocalMedia(item.id, updated)
    showToast('Đã thêm ảnh/video!', 'success')
  } catch (err) {
    console.error('[Media Add]', err)
    showToast('Không thêm được ảnh/video: ' + (err?.message || 'Unknown error'), 'error', 3500)
  } finally {
    if (input) input.value = ''
  }
}
const addSingleDrive = async (item) => {
  const inputEl = document.getElementById(`single-drive-${item.id}`)
  if (!inputEl?.value.trim()) return
  const currentMedia = await loadMediaCached(item.id)
  const link = inputEl.value.trim()
  currentMedia.push({ type: 'image', data: formatDriveLink(link), source: 'drive', original: link })
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  inputEl.value = ''
  mediaCache.set(item.id, currentMedia)
  updateLocalMedia(item.id, currentMedia)
}
const removeMedia = async (item, index) => {
  const confirmed = await openConfirmDialog({
    title: 'Xóa ảnh/video',
    message: 'Bạn có chắc muốn xóa ảnh/video này?',
    confirmText: 'Xóa',
    variant: 'danger',
  })
  if (!confirmed) return
  const currentMedia = await loadMediaCached(item.id)
  const updated = await removeMediaItem(currentMedia, index)
  await supabase.from('customers').update({ media: updated }).eq('id', item.id)
  mediaCache.set(item.id, updated)
  updateLocalMedia(item.id, updated)
  showToast('Đã xóa ảnh!', 'success')
}

// ── DRIVE FOLDER ──────────────────────────────────────────────
const startEditFolder = (id, currentLink) => { isEditingLink.value[id] = true; tempFolderLink.value[id] = currentLink || '' }
const saveFolderLink  = async (id) => {
  const link = tempFolderLink.value[id]
  await supabase.from('customers').update({ folderDrive: link }).eq('id', id)
  isEditingLink.value[id] = false
  if (showDetailModal.value && selectedCustomer.value?.id === id) selectedCustomer.value.folderDrive = link
  if (showOutsideDetailModal.value && selectedOutside.value?.id === id) selectedOutside.value.folderDrive = link
  updateLocalCustomer(id, { folderDrive: link })
  showToast('Đã lưu link Drive!', 'success')
}

// ── HELPERS ───────────────────────────────────────────────────
const selectTreCa = (item) => { searchQuery.value = item.ticketId; closeTreModal() }
const openConfirmDialog = ({ title = 'Xác nhận', message, confirmText = 'Đồng ý', cancelText = 'Hủy', variant = 'primary' }) =>
  new Promise((resolve) => {
    confirmDialog.value = {
      visible: true,
      title,
      message,
      confirmText,
      cancelText,
      variant,
      resolve,
    }
  })
const closeConfirmDialog = (confirmed) => {
  const resolver = confirmDialog.value.resolve
  confirmDialog.value = {
    visible: false,
    title: 'Xác nhận',
    message: '',
    confirmText: 'Đồng ý',
    cancelText: 'Hủy',
    variant: 'primary',
    resolve: null,
  }
  if (typeof resolver === 'function') resolver(confirmed)
}
const parseMaybeJsonDate = (value) => {
  if (!value) return new Date('')
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const match = value.match(/^\/Date\((\-?\d+)(?:[+-]\d+)?\)\/$/)
    if (match) {
      return new Date(Number(match[1]))
    }
  }
  return new Date(value)
}
const formatDate  = (dateStr) => {
  if (!dateStr) return 'Chưa có ngày tạo'
  const d = parseMaybeJsonDate(dateStr)
  return isNaN(d.getTime()) ? 'Ngày không hợp lệ'
    : d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const formatDateOnly = (date) => {
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return 'N/A'
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
const addMonths = (date, months) => {
  const result = new Date(date)
  const originalDay = result.getDate()
  result.setMonth(result.getMonth() + months)
  if (result.getDate() !== originalDay) result.setDate(0)
  return result
}
const getStatusHistory = (logs) => Array.isArray(logs) ? logs.filter(log => typeof log?.status === 'number') : []
const getWarrantyInfo = (item) => {
  if (item?.status !== 2) return null

  let months = item?.warranty_months
  let startRaw = item?.warranty_start_at
  let expiresRaw = item?.warranty_expires_at

  if (!months || !startRaw || !expiresRaw) return null

  const startDate = new Date(startRaw)
  const expiresAt = new Date(expiresRaw)
  if (isNaN(startDate.getTime()) || isNaN(expiresAt.getTime())) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  expiresAt.setHours(23, 59, 59, 999)
  const diffMs = expiresAt.getTime() - today.getTime()
  const daysLeft = Math.ceil(diffMs / 86400000)
  const expired = diffMs < 0

  return {
    label: `Bảo hành ${months} tháng`,
    months,
    startText: formatDateOnly(startDate),
    expiresText: formatDateOnly(expiresAt),
    remainingText: expired ? 'Hết bảo hành' : `Còn ${daysLeft} ngày`,
    expired,
  }
}
const saveWarrantyFor = async (itemRef, months) => {
  if (!itemRef || !itemRef.id) return
  if (!isAdmin.value) {
    showToast('Chỉ admin mới được chỉnh thời gian bảo hành!', 'error')
    return
  }
  if (itemRef.status !== 2) {
    showToast('Chỉ nhập bảo hành khi ca đã hoàn thành!', 'warning')
    return
  }
  const warrantyMonths = Number(months)
  if (!Number.isFinite(warrantyMonths) || warrantyMonths <= 0) {
    showToast('Thời gian bảo hành không hợp lệ!', 'error')
    return
  }
  try {
    await ensureSession()
    const now = new Date()
    const expiresAt = addMonths(now, warrantyMonths)
    const updates = {
      warranty_months: warrantyMonths,
      warranty_start_at: now.toISOString(),
      warranty_expires_at: expiresAt.toISOString(),
    }
    const { error } = await supabase.from('customers').update(updates).eq('id', itemRef.id)
    if (error) throw error
    
    // Cập nhật state current reference
    if (selectedOutside.value?.id === itemRef.id) {
      selectedOutside.value = { ...selectedOutside.value, ...updates }
    }
    if (selectedCustomer.value?.id === itemRef.id) {
      selectedCustomer.value = { ...selectedCustomer.value, ...updates }
    }
    
    updateLocalCustomer(itemRef.id, updates)
    showWarrantyOptions.value = false
    showCustomWarrantyInput.value = false
    customWarrantyMonths.value = ''
    showToast('Đã lưu thời gian bảo hành!', 'success')
  } catch (e) {
    showToast('Không lưu được bảo hành: ' + (e?.message || 'Unknown error'), 'error')
  }
}
const saveCustomWarrantyFor = async (itemRef) => {
  await saveWarrantyFor(itemRef, customWarrantyMonths.value)
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
const exportOutsideHoanThanh = () => exportToExcel(outsideHoanThanh.value, 'Bao-Cao-Ca-Ngoai-Hoan-Thanh')

// ── SWIPE ĐỔI TRẠNG THÁI ──────────────────────────────────────
const swipeBoundElements = new WeakSet()
const setupSwipe = (el, item, isOutside = false) => {
  if (!el) return
  if (swipeBoundElements.has(el)) return
  swipeBoundElements.add(el)
  let startX = 0, startY = 0, swiping = false

  el.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX
    startY = e.touches[0].clientY
    swiping = true
  }, { passive: true })

  el.addEventListener('touchend', async (e) => {
    if (!swiping) return
    swiping = false
    const dx = e.changedTouches[0].clientX - startX
    const dy = e.changedTouches[0].clientY - startY
    // Chỉ xử lý nếu vuốt ngang > 60px và ngang hơn dọc
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return

    const now = new Date()
    const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`

    if (dx > 0) {
      // Vuốt PHẢI → Xong
      if (item.status === 2) return
      const confirmed = await openConfirmDialog({
        title: 'Chốt hoàn thành',
        message: `Chốt xong ca ${item.ticketId}?`,
        confirmText: 'Chốt ca',
        variant: 'success',
      })
      if (!confirmed) return
      const newLog = appendStatusLog(item.statusLog, 2)
      const updates = { status: 2, doneDate: dateStr, statusLog: newLog }
      await supabase.from('customers').update(updates).eq('id', item.id)
      updateLocalCustomer(item.id, updates)
      showToast(`Xong: ${item.ticketId}`, 'success')
    } else {
      // Vuốt TRÁI: Đang làm -> Chờ LK, Chờ LK -> Đang làm
      const nextStatus = item.status === 1 ? 0 : 1
      const newLog = appendStatusLog(item.statusLog, nextStatus)
      const updates = nextStatus === 0
        ? { status: 0, doneDate: null, statusLog: newLog }
        : { status: 1, doneDate: null, statusLog: newLog }
      await supabase.from('customers').update(updates).eq('id', item.id)
      updateLocalCustomer(item.id, updates)
      showToast(
        nextStatus === 0 ? `Đang làm: ${item.ticketId}` : `Chờ LK: ${item.ticketId}`,
        nextStatus === 0 ? 'success' : 'warning'
      )
    }

    // Visual feedback
    el.style.transition = 'transform 0.2s'
    el.style.transform = `translateX(${dx > 0 ? '8px' : '-8px'})`
    setTimeout(() => { el.style.transform = ''; el.style.transition = '' }, 200)
  }, { passive: true })
}

// ── CHIA SẺ THÔNG TIN CA ──────────────────────────────────────
const createOrLoadShareLink = async (customer, rotateToken = false) => {
  if (!customer?.id) throw new Error('Không tìm thấy ca để tạo link')
  if (!isAdmin.value) throw new Error('Chỉ admin mới được dùng link xem khách')
  return ensureShareRecord(supabase, customer.id, currentUser.value?.id, rotateToken)
}

const copyShareLink = async (customer) => {
  try {
    const share = await createOrLoadShareLink(customer)
    await copyText(share.publicUrl)
    showToast(`Đã copy link xem cho ${customer.ticketId}`, 'success')
  } catch (e) {
    showToast('Không tạo được link xem: ' + (e?.message || 'Unknown error'), 'error', 4000)
  }
}

const openShareManager = (customer) => {
  if (!isAdmin.value) {
    showToast('Chỉ admin mới được quản lý link xem!', 'error')
    return
  }
  window.open(buildShareAdminUrl(customer.id), '_blank', 'noopener')
}

let keepAliveTimer = null
let visibilityHandler = null
let focusHandler = null
let broadcastChannel = null
let stopLoginWatch = null

// ── MOUNTED ───────────────────────────────────────────────────
onMounted(async () => {
  hydrateCache()
  await initAuth()
  if (isLoggedIn.value) {
    await loadData()
    syncWarehouseByRole()
  }
  stopLoginWatch = watch(isLoggedIn, async (val) => {
    if (val) {
      hydrateCache()
      await loadData()
      syncWarehouseByRole()
    }
  })

  // ── REALTIME với auto-reconnect ────────────────────────────
  let realtimeDebounce = null
  let realtimeChannel = null

  const setupRealtime = () => {
    if (realtimeChannel) {
      try { supabase.removeChannel(realtimeChannel) } catch {}
      realtimeChannel = null
    }
    realtimeChannel = supabase
      .channel('customers-realtime-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        clearTimeout(realtimeDebounce)
        realtimeDebounce = setTimeout(() => {
          mediaCache.clear()
          loadData()
        }, 1500)
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          setTimeout(setupRealtime, 5000)
        }
      })
  }
  setupRealtime()

  // ── Keepalive: 2 phút ping 1 lần ─────────────────────────
  keepAliveTimer = setInterval(async () => {
    try { await supabase.auth.getSession() } catch {}
    if (!realtimeChannel) { setupRealtime(); return }
    if (realtimeChannel.state !== 'joined') setupRealtime()
  }, 2 * 60 * 1000)

  // ── Visibility change ─────────────────────────────────────
  let lastActiveTime = Date.now()
  let isRecovering = false
  let lastFocusClipboardCheck = 0
  const recoverAppState = async () => {
    if (!isLoggedIn.value || isRecovering || !isOnline.value) return
    const awayMs = Date.now() - lastActiveTime
    isRecovering = true
    try {
      await withTimeout(supabase.auth.getSession(), 2500)
      if (awayMs > 60 * 1000) {
        mediaCache.clear()
        await withTimeout(loadData(), 6000)
      }
    } catch (e) {
      console.warn('Recovery:', e?.message)
    } finally {
      isRecovering = false
    }
  }
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => { recoverAppState() }, 150)
    } else {
      lastActiveTime = Date.now()
    }
  }
  document.addEventListener('visibilitychange', visibilityHandler)

  broadcastChannel = new BroadcastChannel('zalo_bridge')
  broadcastChannel.onmessage = (event) => { if (event.data) customHandleParse(event.data) }

  // Clipboard: chỉ parse nếu text mới
  let lastClipboardText = ''
  focusHandler = () => {
    const now = Date.now()
    if (now - lastFocusClipboardCheck < 2000) return
    lastFocusClipboardCheck = now
    setTimeout(async () => {
      if (!isLoggedIn.value || !isOnline.value) return
      if (showDetailModal.value || showOutsideDetailModal.value || showModal.value || showEditModal.value) return
      if (currentType.value === 'OUTSIDE') return
      try {
        const text = await withTimeout(navigator.clipboard.readText(), 1200)
        if (text && text !== lastClipboardText && (text.includes('ASVN') || text.includes('CSVN'))) {
          lastClipboardText = text
          customHandleParse(text)
        }
      } catch {}
    }, 200)
  }
  window.addEventListener('focus', focusHandler)

  window.addEventListener('resize', syncMobileControlForViewport, { passive: true })
  syncMobileControlForViewport()
})

onUnmounted(() => {
  if (stopLoginWatch) stopLoginWatch()
  if (keepAliveTimer) clearInterval(keepAliveTimer)
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
  if (focusHandler) window.removeEventListener('focus', focusHandler)
  if (broadcastChannel) broadcastChannel.close()
  window.removeEventListener('resize', syncMobileControlForViewport)
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

    <!-- TRANG BIỂU ĐỒ (fullscreen overlay) -->
    <div v-if="showChart" class="chart-overlay">
      <div class="chart-overlay-header">
        <button @click="showChart = false" class="btn-back">← Quay lại</button>
      </div>
      <RevenueChart
        :dangLamAll="stats.dangLamAll"
        :choLKAll="stats.choLKAll"
        :tongTat="stats.tongTat"
        :choLkTre="stats.choLkTre"
      />
    </div>

    <!-- TOAST -->
    <div class="toast-container">
      <div v-for="t in toasts" :key="t.id" :class="['toast-item', `toast-${t.type}`]">{{ t.message }}</div>
    </div>

    <!-- TOP BAR -->
    <div v-show="!showChart" class="topbar">
      <div class="topbar-left">
        <span class="topbar-logo">TV</span>
        <span class="topbar-appname">TV Repair</span>
        <span :class="['role-chip', isAdmin ? 'role-admin' : 'role-nv']">
          {{ isAdmin ? 'Admin' : 'Nhân viên' }}
        </span>
        <span v-if="!isOnline" class="offline-chip">Offline</span>
      </div>
      <div class="topbar-right">
        <input
          v-model="globalSearchQuery"
          type="text"
          class="form-control topbar-search"
          placeholder="Tìm mã ca, SĐT, tên khách..."
        >
        <span class="topbar-user">{{ userName }}</span>
        <button @click="openTreModal" class="btn-topbar btn-topbar--alert">
          <span class="btn-text">Ca trễ</span>
          <span v-if="treCaList.length" class="topbar-badge">{{ treCaList.length }}</span>
        </button>
        <button @click="showChoLkTreModal = true" class="btn-topbar btn-topbar--alert">
          <span class="btn-text">Trễ LK</span>
          <span v-if="choLkTreList.length" class="topbar-badge">{{ choLkTreList.length }}</span>
        </button>
        <button v-if="isAdmin"
          @click="showChart = true"
          class="btn-topbar">
          <span class="btn-text">Biểu đồ</span>
        </button>
        <button v-if="isAdmin"
          @click="showAdminPanel = !showAdminPanel"
          :class="['btn-topbar', showAdminPanel ? 'btn-topbar--active' : '']">
          <span class="btn-text">Quản lý TK</span>
        </button>
        <button @click="logout" class="btn-topbar btn-topbar--logout"><span class="btn-text">Thoát</span></button>
      </div>
    </div>

    <!-- ADMIN PANEL -->
    <div v-if="showAdminPanel && isAdmin && !showChart" class="admin-panel-wrap">
      <AdminPanel />
    </div>

    <div v-show="!showChart" class="layout">
      <div
        :class="['control-card', 'control-card--sticky', { 'control-card--mobile-collapsed': isMobileControlCollapsed }]"
        @click="expandMobileControlCard"
      >
        <div class="filter-toolbar">
          <div class="filter-summary">
            <div class="filter-title">Danh sách công việc</div>
            <div class="filter-meta-text">{{ currentType }} · {{ currentType === 'OUTSIDE' ? 'Ca ngoài' : (showWarehouse ? currentWarehouse : 'Tất cả kho') }}</div>
          </div>
          <button @click.stop="toggleFilterPanel" class="btn btn-outline-secondary fw-bold filter-button">
            {{ showFilters ? 'Ẩn bộ lọc' : 'Bộ lọc' }}
          </button>
        </div>

        <div v-if="showFilters && !isMobileControlCollapsed" class="filter-panel" @click.stop>
          <div class="filter-grid">
            <div class="filter-field">
              <label class="filter-label">Loại ca</label>
              <select v-model="currentType" class="form-select" @change="selectType(currentType)">
                <option value="ASVN">ASVN</option>
                <option value="CSVN">CSVN</option>
                <option value="OUTSIDE">Ca ngoài</option>
              </select>
            </div>
            <div v-if="currentType === 'ASVN'" class="filter-field">
              <label class="filter-label">Kho</label>
              <select
                v-model="currentWarehouse"
                class="form-select"
                :disabled="hasLockedWarehouse"
                @change="selectWarehouse(currentWarehouse)"
              >
                <option v-for="wh in availableWarehouses" :key="wh" :value="wh">
                  {{ wh === 'TDP' ? 'Kho TDP' : 'Kho NV' }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <div v-if="currentType !== 'OUTSIDE'" class="status-toggle-row status-toggle-row--sticky" @click.stop>
          <button @click="showTab = 'danglam'" :class="['btn fw-bold flex-grow-1', showTab==='danglam' ? 'btn-primary text-white' : 'btn-outline-primary']">
            <span class="tab-label">ĐANG LÀM</span> ({{ dangLam.length }})
          </button>
          <button @click="showTab = 'cholinkien'" :class="['btn fw-bold flex-grow-1', showTab==='cholinkien' ? 'btn-warning text-white' : 'btn-outline-warning']">
            <span class="tab-label">CHỜ LK</span> ({{ choLinhKien.length }})
          </button>
          <button @click="showTab = 'hoanthanh'" :class="['btn fw-bold flex-grow-1', showTab==='hoanthanh' ? 'btn-success text-white' : 'btn-outline-success']">
            <span class="tab-label">XONG</span> ({{ Object.values(hoanThanh).flat().length }})
          </button>
        </div>

        <!-- Tabs Ca Ngoài -->
        <div v-if="currentType === 'OUTSIDE'" class="status-toggle-row status-toggle-row--sticky" @click.stop>
          <button @click="outsideTab = 'danglam'" :class="['btn fw-bold flex-grow-1', outsideTab==='danglam' ? 'btn-primary text-white' : 'btn-outline-primary']">
            <span class="tab-label">ĐANG LÀM</span> ({{ outsideDangLam.length }})
          </button>
          <button @click="outsideTab = 'cholinkien'" :class="['btn fw-bold flex-grow-1', outsideTab==='cholinkien' ? 'btn-warning text-white' : 'btn-outline-warning']">
            <span class="tab-label">CHỜ LK</span> ({{ outsideChoLinhKien.length }})
          </button>
          <button @click="outsideTab = 'hoanthanh'" :class="['btn fw-bold flex-grow-1', outsideTab==='hoanthanh' ? 'btn-success text-white' : 'btn-outline-success']">
            <span class="tab-label">XONG</span> ({{ outsideHoanThanh.length }})
          </button>
        </div>

        <!-- Control body ASVN / CSVN -->
        <div v-if="(currentType === 'ASVN' || currentType === 'CSVN') && !isMobileControlCollapsed">
          <div v-if="showTab === 'danglam'" class="control-body" @click.stop>
            <div class="control-actions">
              <button @click="openQuickCreateModal" class="btn btn-primary fw-bold">+ TẠO / DÁN CA</button>
              <button @click="openRouteModal" class="btn btn-info fw-bold">HÀNH TRÌNH</button>
              <input type="text" v-model="searchQuery" class="form-control" placeholder="Tìm kiếm nhanh...">
            </div>
            <div class="control-subfilters">
              <select v-model="createdDateFilter" class="form-select">
                <option value="all">Tất cả ngày tạo</option>
                <option value="today">Tạo hôm nay</option>
                <option value="week">Tuần này</option>
              </select>
              <select v-model="sortOption" class="form-select">
                <option value="newest">Mới nhất lên đầu</option>
                <option value="oldest">Cũ nhất lên đầu</option>
                <option value="warehouse">Theo kho TDP → NV</option>
              </select>
            </div>
          </div>

          <div v-else-if="showTab === 'cholinkien'" class="control-body" @click.stop>
            <input v-model="searchQuery" type="text" class="form-control" placeholder="Tìm theo tên, SĐT, mã ca, model, serial, linh kiện...">
            <div class="control-subfilters">
              <select v-model="sortOption" class="form-select">
                <option value="newest">Mới nhất lên đầu</option>
                <option value="oldest">Cũ nhất lên đầu</option>
                <option value="warehouse">Theo kho TDP → NV</option>
              </select>
            </div>
          </div>

          <div v-else-if="showTab === 'hoanthanh'" class="control-body" @click.stop>
            <div class="d-flex gap-2 flex-wrap">
              <input type="text" v-model="historySearchQuery" class="form-control flex-grow-1 mb-2"
                placeholder="Tìm trong lịch sử...">
              <input type="date" v-model="completedDateFrom" class="form-control mb-2" title="Từ ngày">
              <input type="date" v-model="completedDateTo" class="form-control mb-2" title="Đến ngày">
              <select v-model="sortOption" class="form-select mb-2">
                <option value="newest">Mới nhất lên đầu</option>
                <option value="oldest">Cũ nhất lên đầu</option>
                <option value="warehouse">Theo kho TDP → NV</option>
              </select>
              <template v-if="isAdmin">
                <div v-if="showWarehouse" class="d-flex gap-1 w-100">
                  <button @click="exportHoanThanhByWarehouse('TDP')" class="btn btn-outline-primary fw-bold flex-grow-1">Xuất TDP</button>
                  <button @click="exportHoanThanhByWarehouse('NV')"  class="btn btn-outline-success fw-bold flex-grow-1">Xuất NV</button>
                </div>
                <button v-else @click="exportAllHoanThanh" class="btn btn-outline-dark fw-bold">XUẤT EXCEL</button>
              </template>
            </div>
          </div>
        </div>

        <!-- Control body Ca Ngoài -->
        <div v-else-if="currentType === 'OUTSIDE' && !isMobileControlCollapsed" class="control-body" @click.stop>
          <div class="control-body-header">
            <div>
              <div class="control-body-title">Ca ngoài</div>
              <div class="control-body-note">Dùng nút + nổi để tạo ca mới nhanh hơn.</div>
            </div>
            <button @click="openOutsideForm" class="btn btn-success fw-bold btn-sm">+ Tạo ca</button>
          </div>
          <input type="text" v-model="searchQuery" class="form-control mt-1" placeholder="Tìm kiếm nhanh...">
          <div class="control-subfilters mt-2">
            <select v-if="outsideTab === 'danglam'" v-model="createdDateFilter" class="form-select">
              <option value="all">Tất cả ngày tạo</option>
              <option value="today">Tạo hôm nay</option>
              <option value="week">Tuần này</option>
            </select>
            <select v-model="sortOption" class="form-select">
              <option value="newest">Mới nhất lên đầu</option>
              <option value="oldest">Cũ nhất lên đầu</option>
              <option value="warehouse">Theo kho TDP → NV</option>
            </select>
          </div>
          <div v-if="outsideTab === 'hoanthanh'" class="d-flex gap-2 flex-wrap mt-2">
            <input type="date" v-model="completedDateFrom" class="form-control">
            <input type="date" v-model="completedDateTo" class="form-control">
            <button v-if="isAdmin" @click="exportOutsideHoanThanh" class="btn btn-outline-dark fw-bold">Xuất Excel ca ngoài</button>
          </div>
        </div>

        <button
          v-if="isMobileControlCollapsed"
          @click.stop="expandMobileControlCard"
          class="control-card-expand"
        >
          Mở rộng
        </button>
        <button
          v-if="!isMobileControlCollapsed"
          @click.stop="collapseMobileControlCard"
          class="control-card-collapse"
        >
          Thu gọn
        </button>
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

        <div v-if="isGlobalSearchActive">
          <div v-if="globalSearchResults.length">
            <h5 class="mb-3">Kết quả tìm kiếm ({{ globalSearchResults.length }})</h5>
            <div class="case-strip">
              <div
                v-for="item in globalSearchResults"
                :key="item.id"
                class="case-card"
                @click="openCustomerFromSearch(item)"
                style="cursor:pointer;"
              >
                <div class="card border-0 shadow-sm h-100">
                  <div class="card-body border-start border-5 border-info">
                    <div class="case-head">
                      <div class="d-flex align-items-center gap-2 flex-wrap">
                        <span class="case-ticket text-primary">{{ item.ticketId }}</span>
                        <span class="badge bg-dark-subtle text-dark">{{ getTypeLabel(item.ticketId) }}</span>
                        <span class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) || 'Không kho' }}</span>
                        <span class="badge" :class="item.status === 0 ? 'bg-secondary' : item.status === 1 ? 'bg-warning text-dark' : 'bg-success'">{{ getStatusLabel(item.status) }}</span>
                      </div>
                    </div>
                    <div class="case-main">
                      <div class="case-primary">
                        <div class="case-customer">{{ item.name }}</div>
                        <a :href="'tel:'+item.phone" @click.stop class="case-phone text-decoration-none">{{ item.phone }}</a>
                      </div>
                      <div class="case-model">Model: {{ item.model }}</div>
                      <div class="case-issue">Lỗi: {{ item.issue }}</div>
                      <div class="case-meta">Ngày tạo: {{ formatDate(item.createdAt) }}</div>
                      <div class="case-part">Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-center text-muted py-5">Không có ca nào khớp từ khóa</div>
        </div>

        <!-- ── ASVN / CSVN ── -->
        <div v-else-if="currentType !== 'OUTSIDE'">

          <!-- Đang làm -->
          <div v-if="showTab === 'danglam'">
            <div v-if="dangLam.length">
              <h5 class="mb-3">Đang làm ({{ dangLam.length }})</h5>
              <div class="case-strip">
                <div v-for="item in dangLam" :key="item.id" class="case-card swipe-card"
                  :ref="el => el && setupSwipe(el, item)"
                  @click="openDetailModalFull(item)" style="cursor:pointer;">
                  <div class="swipe-hint-right">Xong</div>
                  <div class="swipe-hint-left">Chờ LK</div>
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-primary d-flex flex-column">
                      <div class="case-head">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                          <input type="checkbox" @click.stop @change="hoanTatKiemTra(item, $event)" style="width:20px;height:20px;">
                          <span class="case-ticket text-primary">{{ item.ticketId }}</span>
                          <span v-if="item.warehouse" class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) }}</span>
                          <span class="badge bg-secondary">Đang xử lý</span>
                        </div>
                      </div>
                      <div class="case-main">
                        <div class="case-primary">
                          <div class="case-customer">{{ item.name }}</div>
                          <a :href="'tel:'+item.phone" @click.stop class="case-phone text-decoration-none">{{ item.phone }}</a>
                        </div>
                        <div class="case-model">Model: {{ item.model }}</div>
                        <div class="case-issue">Lỗi: {{ item.issue }}</div>
                        <div class="case-meta">Địa chỉ: {{ item.address }}</div>
                        <div class="case-part">Linh kiện: {{ item.replacedPart || 'Chưa có linh kiện' }}</div>
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
                <div v-for="item in choLinhKien" :key="item.id" class="case-card swipe-card"
                  :ref="el => el && setupSwipe(el, item)"
                  @click="openDetailModalFull(item)" style="cursor:pointer;">
                  <div class="swipe-hint-right">Xong</div>
                  <div class="swipe-hint-left">Đang làm</div>
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-warning d-flex flex-column">
                      <div class="case-head flex-wrap gap-2">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                          <button @click.stop="dongCa(item)" class="btn btn-sm btn-success">Chốt ca</button>
                          <span class="case-ticket text-primary">{{ item.ticketId }}</span>
                          <span v-if="item.warehouse" class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) }}</span>
                          <span class="badge bg-warning text-dark">Chờ linh kiện</span>
                        </div>
                      </div>
                      <div class="case-main">
                        <div class="case-primary">
                          <div class="case-customer">{{ item.name }}</div>
                          <a :href="'tel:'+item.phone" @click.stop class="case-phone text-decoration-none">{{ item.phone }}</a>
                        </div>
                        <div class="case-model">Model: {{ item.model }}</div>
                        <div class="case-issue">Lỗi: {{ item.issue }}</div>
                        <div class="case-meta">Địa chỉ: {{ item.address }}</div>
                        <div class="case-part">Linh kiện: {{ item.replacedPart || 'Chưa có linh kiện' }}</div>
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
                <div class="mb-3"><span class="date-pill">{{ date }} ({{ group.length }} ca)</span></div>
                <div class="case-strip">
                  <div v-for="item in group" :key="item.id" class="case-card"
                    @click="openDetailModalFull(item)" style="cursor:pointer;">
                    <div class="card border-0 shadow-sm">
                      <div class="card-body border-start border-5 border-success">
                        <div class="d-flex justify-content-between mb-2 flex-wrap gap-2">
                          <span class="fw-bold text-success">{{ item.ticketId }} - {{ item.name }}</span>
                          <span v-if="item.warehouse" class="badge" :class="getWarehouseBadgeClass(item.warehouse)">{{ getWarehouseLabel(item) }}</span>
                          <div class="d-flex gap-1">
                            <button v-if="isAdmin" @click.stop="copyShareLink(item)" class="btn btn-sm btn-info text-white fw-bold">Copy link xem</button>
                            <button @click.stop="revertToDangLam(item)" class="btn btn-sm btn-warning">Hoàn lại</button>
                          </div>
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
          <div v-if="outsideTab === 'danglam'">
            <div v-if="outsideDangLam.length">
              <h5 class="mb-3">Đang làm ({{ outsideDangLam.length }})</h5>
              <div class="case-strip">
                <div v-for="item in outsideDangLam" :key="item.id" class="case-card swipe-card"
                  :ref="el => el && setupSwipe(el, item, true)"
                  @click="openOutsideDetailModal(item)" style="cursor:pointer;">
                  <div class="swipe-hint-right">Xong</div>
                  <div class="swipe-hint-left">Chờ LK</div>
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-primary">
                      <div class="case-head">
                        <span class="case-ticket text-primary">{{ item.ticketId }}</span>
                      </div>
                      <div class="case-main">
                        <div class="case-primary">
                          <div class="case-customer">{{ item.name }}</div>
                          <a :href="'tel:'+item.phone" @click.stop class="case-phone text-decoration-none">{{ item.phone }}</a>
                        </div>
                        <div class="case-model">Model: {{ item.model }}</div>
                        <div class="case-issue">Lỗi: {{ item.issue }}</div>
                        <div class="case-part">Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca ngoài đang làm</div>
          </div>
          <div v-if="outsideTab === 'cholinkien'">
            <div v-if="outsideChoLinhKien.length">
              <h5 class="mb-3">Chờ linh kiện ({{ outsideChoLinhKien.length }})</h5>
              <div class="case-strip">
                <div v-for="item in outsideChoLinhKien" :key="item.id" class="case-card swipe-card"
                  :ref="el => el && setupSwipe(el, item, true)"
                  @click="openOutsideDetailModal(item)" style="cursor:pointer;">
                  <div class="swipe-hint-right">Xong</div>
                  <div class="swipe-hint-left">Đang làm</div>
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-warning">
                      <div class="case-head">
                        <span class="case-ticket text-primary">{{ item.ticketId }}</span>
                      </div>
                      <div class="case-main">
                        <div class="case-primary">
                          <div class="case-customer">{{ item.name }}</div>
                          <a :href="'tel:'+item.phone" @click.stop class="case-phone text-decoration-none">{{ item.phone }}</a>
                        </div>
                        <div class="case-model">Model: {{ item.model }}</div>
                        <div class="case-issue">Lỗi: {{ item.issue }}</div>
                        <div class="case-part">Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted py-5">Chưa có ca ngoài chờ linh kiện</div>
          </div>
          <div v-if="outsideTab === 'hoanthanh'">
            <div v-if="outsideHoanThanh.length">
              <h5 class="mb-3">Hoàn thành ({{ outsideHoanThanh.length }})</h5>
              <div class="case-strip">
                <div v-for="item in outsideHoanThanh" :key="item.id" class="case-card"
                  @click="openOutsideDetailModal(item)" style="cursor:pointer;">
                  <div class="card border-0 shadow-sm h-100">
                    <div class="card-body border-start border-5 border-success">
                      <div class="case-head">
                        <span class="case-ticket text-success">{{ item.ticketId }}</span>
                      </div>
                      <div class="case-main">
                        <div class="case-primary">
                          <div class="case-customer">{{ item.name }}</div>
                          <a :href="'tel:'+item.phone" @click.stop class="case-phone text-decoration-none">{{ item.phone }}</a>
                        </div>
                        <div class="case-model">Model: {{ item.model }}</div>
                        <div v-if="getWarrantyInfo(item)" :class="['small fw-bold mb-1', getWarrantyInfo(item).expired ? 'text-danger' : 'text-success']">
                        Bảo hành: {{ getWarrantyInfo(item).remainingText }}
                        </div>
                        <div class="case-issue">Lỗi: {{ item.issue }}</div>
                        <div class="case-part">Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                      </div>
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
              <div class="detail-tabs">
                <button @click="detailModalTab = 'info'" :class="['detail-tab-btn', detailModalTab === 'info' ? 'detail-tab-btn--active' : '']">Thông tin</button>
                <button @click="detailModalTab = 'media'" :class="['detail-tab-btn', detailModalTab === 'media' ? 'detail-tab-btn--active' : '']">Ảnh & Video</button>
                <button @click="detailModalTab = 'finance'" :class="['detail-tab-btn', detailModalTab === 'finance' ? 'detail-tab-btn--active' : '']">Viện phí</button>
              </div>
              <div class="row">
                <div v-show="detailModalTab === 'info' || detailModalTab === 'finance'" class="col-md-5">
                  <h5 class="mb-1 fw-bold">{{ selectedCustomer.name }}</h5>
                  <a :href="'tel:'+selectedCustomer.phone" class="text-secondary fw-bold mb-2 d-block text-decoration-none">{{ selectedCustomer.phone }}</a>
                  <p v-if="selectedCustomer.warehouse"><strong>Kho:</strong> {{ selectedCustomer.warehouse }}</p>
                  <p v-if="selectedCustomer.serial"><strong>Serial:</strong> {{ selectedCustomer.serial }}</p>
                  <p v-if="selectedCustomer.branch"><strong>Chi nhánh:</strong> {{ selectedCustomer.branch }}</p>
                  <p><strong>Model:</strong> {{ selectedCustomer.model }}</p>
                  <p><strong>Địa chỉ:</strong> {{ selectedCustomer.address }}</p>
                  <p><strong>Lỗi:</strong> <span class="text-danger fw-bold">{{ selectedCustomer.issue }}</span></p>
                  <div class="mt-3 mb-3">
                    <label class="form-label fw-bold">Ghi chú:</label>
                    <textarea v-model="selectedCustomer.note" class="form-control" rows="3" placeholder="Ghi chú kỹ thuật như đã gọi khách, lịch hẹn..."></textarea>
                    <div class="mt-2 d-flex justify-content-end">
                      <button @click="saveCustomerNote" class="btn btn-outline-primary btn-sm fw-bold">Lưu ghi chú</button>
                    </div>
                  </div>
                  <p><strong>Ngày tạo:</strong> {{ formatDate(selectedCustomer.createdAt) }}</p>
                  <p v-if="selectedCustomer.doneDate"><strong>Ngày hoàn thành:</strong> {{ selectedCustomer.doneDate }}</p>
                  <div class="mt-3 mb-3 status-editor">
                    <label class="form-label fw-bold">Trạng thái:</label>
                    <div class="status-editor-row">
                      <select v-model="detailStatusDraft" class="form-select" :disabled="isStatusActionLoading">
                        <option :value="0">Đang làm</option>
                        <option :value="1">Chờ linh kiện</option>
                        <option :value="2">Hoàn thành</option>
                      </select>
                      <button @click="applyDetailStatus" class="btn btn-primary fw-bold" :disabled="isStatusActionLoading">
                        {{ isStatusActionLoading ? 'Đang lưu...' : 'Cập nhật' }}
                      </button>
                    </div>
                  </div>
                  <div v-if="getStatusHistory(selectedCustomer.statusLog).length" class="mt-2 mb-3">
                    <label class="form-label fw-bold">Lịch sử trạng thái:</label>
                    <div class="status-log">
                      <div v-for="(log, i) in getStatusHistory(selectedCustomer.statusLog)" :key="i" class="status-log-item">
                        <span :class="['log-badge', log.status===0?'log-blue':log.status===1?'log-yellow':'log-green']">{{ log.label }}</span>
                        <span class="log-meta">{{ log.by }} · {{ log.at }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="mt-3">
                    <label class="form-label fw-bold">Link Drive:</label>
                    <div v-if="!selectedCustomer.folderDrive || isEditingLink[selectedCustomer.id]" class="input-group input-group-sm">
                      <input v-model="tempFolderLink[selectedCustomer.id]" class="form-control" placeholder="Dán link Google Drive..." @keyup.enter="saveFolderLink(selectedCustomer.id)">
                      <button @click="saveFolderLink(selectedCustomer.id)" class="btn btn-primary fw-bold">Lưu</button>
                    </div>
                    <div v-else class="d-flex gap-2">
                      <a :href="selectedCustomer.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">MỞ DRIVE</a>
                      <button @click="startEditFolder(selectedCustomer.id, selectedCustomer.folderDrive)" class="btn btn-sm btn-light border fw-bold">Sửa</button>
                    </div>
                  </div>
                  <!-- GIÁ TIỀN -->
                  <div v-show="detailModalTab === 'finance'" class="mt-3 price-block">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                      <label class="form-label fw-bold mb-0">Phí sửa chữa:</label>
                      <button v-if="isAdmin" @click="openPriceEditor(selectedCustomer)" class="btn btn-sm btn-outline-success fw-bold">+ Linh kiện / Giá</button>
                    </div>
                    <div v-if="selectedCustomer.lkItems?.length" class="lk-price-list mb-2">
                      <div v-for="(lk, i) in selectedCustomer.lkItems" :key="i" class="lk-price-row">
                        <span>{{ lk.name }}</span>
                        <span class="fw-bold text-success">{{ formatPrice(lk.price) }}</span>
                      </div>
                      <div class="lk-price-total">
                        <span>Tổng linh kiện</span>
                        <span>{{ formatPrice(totalLkPrice(selectedCustomer.lkItems)) }}</span>
                      </div>
                    </div>
                    <div class="price-display">
                      <span>Tổng phí:</span>
                      <span class="price-value">{{ formatPrice(selectedCustomer.price) }}</span>
                    </div>
                  </div>
                </div>
                <div v-show="detailModalTab === 'media' || detailModalTab === 'finance'" class="col-md-7">
                  <h6 class="mb-3">Ảnh &amp; Video</h6>
                  <div v-if="isCustomerMediaLoading" class="text-muted small mb-3">Đang tải ảnh...</div>
                  <div v-else-if="!selectedCustomer.media?.length" class="text-muted small mb-3">Chưa có ảnh/video</div>
                  <div class="media-grid">
                    <div v-for="(m, idx) in selectedCustomer.media || []" :key="idx" class="media-item position-relative">
                      <img v-if="m.type!=='video'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh" style="cursor:pointer;" loading="lazy">
                      <video v-else :src="m.data" preload="metadata" playsinline muted @click="openMediaModal(m)" style="cursor:pointer;"></video>
                      <span @click.stop="removeMedia(selectedCustomer, idx)" class="media-del">×</span>
                    </div>
                    <label class="media-add">
                      <span>+</span>
                      <input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, selectedCustomer)">
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button v-if="isAdmin" @click="copyShareLink(selectedCustomer)" class="btn btn-info fw-bold text-white">Copy link xem</button>
              <button v-if="isAdmin" @click="openShareManager(selectedCustomer)" class="btn btn-outline-info fw-bold">Quản lý link</button>
              <button @click="openEditModal(selectedCustomer, 'asvn')" class="btn btn-warning fw-bold">Sửa ca</button>
              <button v-if="isAdmin" @click="deleteCustomer(selectedCustomer.id)" class="btn btn-danger">Xóa ca</button>
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
              <div class="detail-tabs">
                <button @click="outsideModalTab = 'info'" :class="['detail-tab-btn', outsideModalTab === 'info' ? 'detail-tab-btn--active' : '']">Thông tin</button>
                <button @click="outsideModalTab = 'media'" :class="['detail-tab-btn', outsideModalTab === 'media' ? 'detail-tab-btn--active' : '']">Ảnh & Video</button>
                <button @click="outsideModalTab = 'finance'" :class="['detail-tab-btn', outsideModalTab === 'finance' ? 'detail-tab-btn--active' : '']">Viện phí</button>
              </div>
              <div class="row">
                <div v-show="outsideModalTab === 'info' || outsideModalTab === 'finance'" class="col-md-5">
                  <h5 class="mb-1 fw-bold">{{ selectedOutside.name }}</h5>
                  <a :href="'tel:'+selectedOutside.phone" class="text-secondary fw-bold mb-3 d-block text-decoration-none">{{ selectedOutside.phone }}</a>
                  <p><strong>Model:</strong> {{ selectedOutside.model }}</p>
                  <div class="mt-3 mb-3">
                    <label class="form-label fw-bold">Ghi chú:</label>
                    <textarea v-model="selectedOutside.note" class="form-control" rows="3" placeholder="Nhập và lưu ghi chú để thấy trông link"></textarea>
                    <div class="mt-2 d-flex justify-content-end">
                      <button @click="saveOutsideNote" class="btn btn-outline-primary btn-sm fw-bold">Lưu ghi chú</button>
                    </div>
                  </div>
                  <p><strong>Lỗi:</strong> <span class="text-danger fw-bold">{{ selectedOutside.issue }}</span></p>
                  <p><strong>Ngày tạo:</strong> {{ formatDate(selectedOutside.createdAt) }}</p>
                  <p v-if="selectedOutside.doneDate"><strong>Ngày hoàn thành:</strong> {{ selectedOutside.doneDate }}</p>
                  <div class="mt-3 mb-3 status-editor">
                    <label class="form-label fw-bold">Trạng thái:</label>
                    <div class="status-editor-row">
                      <select v-model="outsideStatusDraft" class="form-select" :disabled="isStatusActionLoading">
                        <option :value="0">Đang làm</option>
                        <option :value="1">Chờ linh kiện</option>
                        <option :value="2">Hoàn thành</option>
                      </select>
                      <button @click="applyOutsideStatus" class="btn btn-primary fw-bold" :disabled="isStatusActionLoading">
                        {{ isStatusActionLoading ? 'Đang lưu...' : 'Cập nhật' }}
                      </button>
                    </div>
                  </div>
                  <div v-if="getStatusHistory(selectedOutside.statusLog).length" class="mt-2 mb-3">
                    <label class="form-label fw-bold">Lịch sử trạng thái:</label>
                    <div class="status-log">
                      <div v-for="(log, i) in getStatusHistory(selectedOutside.statusLog)" :key="i" class="status-log-item">
                        <span :class="['log-badge', log.status===0?'log-blue':log.status===1?'log-yellow':'log-green']">{{ log.label }}</span>
                        <span class="log-meta">{{ log.by }} · {{ log.at }}</span>
                      </div>
                    </div>
                  </div>
                  <div v-if="selectedOutside.status === 2" class="mt-3 warranty-block">
                    <div class="d-flex justify-content-between align-items-center mb-2 gap-2 flex-wrap">
                      <label class="form-label fw-bold mb-0">Bảo hành ca ngoài:</label>
                      <button v-if="isAdmin" @click="showWarrantyOptions = !showWarrantyOptions" class="btn btn-sm btn-outline-primary fw-bold">
                        {{ getWarrantyInfo(selectedOutside) ? 'Đổi thời gian BH' : '+ Thêm bảo hành' }}
                      </button>
                    </div>
                    <div v-if="getWarrantyInfo(selectedOutside)" class="warranty-summary">
                      <div><strong>Gói:</strong> {{ getWarrantyInfo(selectedOutside).label }}</div>
                      <div><strong>Bắt đầu:</strong> {{ getWarrantyInfo(selectedOutside).startText }}</div>
                      <div><strong>Hết hạn:</strong> {{ getWarrantyInfo(selectedOutside).expiresText }}</div>
                      <div :class="['fw-bold', getWarrantyInfo(selectedOutside).expired ? 'text-danger' : 'text-success']">
                        {{ getWarrantyInfo(selectedOutside).remainingText }}
                      </div>
                    </div>
                    <div v-if="showWarrantyOptions" class="warranty-actions">
                      <div class="d-flex gap-2 flex-wrap">
                        <button @click="saveWarrantyFor(selectedOutside, 1)" class="btn btn-outline-primary btn-sm fw-bold">1 tháng</button>
                        <button @click="saveWarrantyFor(selectedOutside, 3)" class="btn btn-outline-primary btn-sm fw-bold">3 tháng</button>
                        <button @click="saveWarrantyFor(selectedOutside, 6)" class="btn btn-outline-primary btn-sm fw-bold">6 tháng</button>
                        <button @click="showCustomWarrantyInput = !showCustomWarrantyInput" class="btn btn-outline-dark btn-sm fw-bold">Tự nhập</button>
                      </div>
                      <div v-if="showCustomWarrantyInput" class="input-group input-group-sm mt-2">
                        <input v-model.number="customWarrantyMonths" type="number" min="1" class="form-control" placeholder="Nhập số tháng bảo hành...">
                        <button @click="saveCustomWarrantyFor(selectedOutside)" class="btn btn-primary fw-bold">Lưu</button>
                      </div>
                    </div>
                  </div>
                  <div class="mt-3">
                    <label class="form-label fw-bold">Link Drive:</label>
                    <div v-if="!selectedOutside.folderDrive || isEditingLink[selectedOutside.id]" class="input-group input-group-sm">
                      <input v-model="tempFolderLink[selectedOutside.id]" class="form-control" placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(selectedOutside.id)">
                      <button @click="saveFolderLink(selectedOutside.id)" class="btn btn-primary">Lưu</button>
                    </div>
                    <div v-else class="d-flex gap-2">
                      <a :href="selectedOutside.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">MỞ DRIVE</a>
                      <button @click="startEditFolder(selectedOutside.id, selectedOutside.folderDrive)" class="btn btn-sm btn-light border">Sửa</button>
                    </div>
                  </div>
                  <!-- GIÁ TIỀN Ca Ngoài -->
                  <div v-show="outsideModalTab === 'finance'" class="mt-3 price-block">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                      <label class="form-label fw-bold mb-0">Phí sửa chữa:</label>
                      <button v-if="isAdmin" @click="openPriceEditor(selectedOutside)" class="btn btn-sm btn-outline-success fw-bold">+ Linh kiện / Giá</button>
                    </div>
                    <div v-if="selectedOutside.lkItems?.length" class="lk-price-list mb-2">
                      <div v-for="(lk, i) in selectedOutside.lkItems" :key="i" class="lk-price-row">
                        <span>{{ lk.name }}</span>
                        <span class="fw-bold text-success">{{ formatPrice(lk.price) }}</span>
                      </div>
                      <div class="lk-price-total">
                        <span>Tổng linh kiện</span>
                        <span>{{ formatPrice(totalLkPrice(selectedOutside.lkItems)) }}</span>
                      </div>
                    </div>
                    <div class="price-display">
                      <span>Tổng phí:</span>
                      <span class="price-value">{{ formatPrice(selectedOutside.price) }}</span>
                    </div>
                  </div>
                </div>
                <div v-show="outsideModalTab === 'media' || outsideModalTab === 'finance'" class="col-md-7">
                  <h6 class="mb-3">Ảnh &amp; Video</h6>
                  <div v-if="isOutsideMediaLoading" class="text-muted small mb-3">Đang tải ảnh...</div>
                  <div v-else-if="!selectedOutside.media?.length" class="text-muted small mb-3">Chưa có ảnh/video</div>
                  <div class="media-grid">
                    <div v-for="(m, idx) in selectedOutside.media || []" :key="idx" class="media-item position-relative">
                      <img v-if="m.type!=='video'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh" style="cursor:pointer;" loading="lazy">
                      <video v-else :src="m.data" preload="metadata" playsinline muted @click="openMediaModal(m)" style="cursor:pointer;"></video>
                      <span @click.stop="removeMedia(selectedOutside, idx)" class="media-del">×</span>
                    </div>
                    <label class="media-add">
                      <span>+</span>
                      <input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, selectedOutside)">
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button v-if="isAdmin" @click="copyShareLink(selectedOutside)" class="btn btn-info fw-bold text-white">Copy link xem</button>
              <button v-if="isAdmin" @click="openShareManager(selectedOutside)" class="btn btn-outline-info fw-bold">Quản lý link</button>
              <button @click="openEditModal(selectedOutside, 'outside')" class="btn btn-warning fw-bold">Sửa ca</button>
              <button v-if="isAdmin" @click="deleteCustomer(selectedOutside.id)" class="btn btn-danger">Xóa ca</button>
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
              <!-- Ô dán nhanh -->
              <div class="mb-3 p-3 rounded" style="background:#f0fdf4;border:1px solid #bbf7d0;">
                <label class="form-label fw-bold mb-1">Dán thông tin nhanh</label>
                <div class="d-flex gap-2">
                  <textarea v-model="outsideRawInput" class="form-control" rows="2"
                    placeholder='Dán nội dung'></textarea>
                  <button @click="parseOutsideText" :disabled="!outsideRawInput.trim()"
                    class="btn btn-success fw-bold" style="white-space:nowrap;min-width:80px;">
                    Lọc
                  </button>
                </div>
                <small class="text-muted mt-1 d-block">Dán xong bấm Lọc → tự điền vào form bên dưới</small>
              </div>
              <!-- Form nhập thủ công -->
              <div class="mb-3"><label class="form-label fw-bold">Tên khách hàng</label>
                <input v-model="outsideForm.name" type="text" class="form-control" placeholder="VD: Anh Hòa, Chị Mai..."></div>
              <div class="mb-3"><label class="form-label fw-bold">SĐT <span class="text-danger">*</span></label>
                <input v-model="outsideForm.phone" type="tel" class="form-control" placeholder="0905123456"></div>
              <div class="mb-3"><label class="form-label fw-bold">Hãng TV</label>
                <input v-model="outsideForm.brand" type="text" class="form-control" placeholder="Xiaomi, Samsung, LG..."></div>
              <div class="mb-3"><label class="form-label fw-bold">Model TV</label>
                <input v-model="outsideForm.model" type="text" class="form-control" placeholder="VD: TV A2 2025"></div>
              <div class="mb-3"><label class="form-label fw-bold">Tình trạng <span class="text-danger">*</span></label>
                <textarea v-model="outsideForm.issue" class="form-control" rows="3" placeholder="VD: Màn hình đen..."></textarea></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeOutsideForm">Đóng</button>
              <button type="button" class="btn btn-success" @click="saveOutsideCa">Lưu Ca Ngoài</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ MODAL TẠO / DÁN CA ══ -->
      <div v-if="showQuickCreateModal" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.55);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-primary text-white">
              <h5 class="modal-title">Tạo Ca Mới</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeQuickCreateModal"></button>
            </div>
            <div class="modal-body">
              <label class="form-label fw-bold">Dán nội dung để tự nhận diện</label>
              <textarea
                v-model="rawInput"
                rows="6"
                class="form-control"
                placeholder="Dán nội dung ASVN / CSVN / Zalo vào đây..."
                @keyup.enter="customHandleParse(rawInput)"
              ></textarea>
              <small class="text-muted d-block mt-2">Hệ thống sẽ tự parse khi nội dung hợp lệ.</small>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeQuickCreateModal">Đóng</button>
              <button @click="customHandleParse(rawInput); closeQuickCreateModal()" class="btn btn-primary fw-bold" :disabled="isParsing">
                {{ isParsing ? 'Đang xử lý...' : 'Nhập khách' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ MODAL PHÓNG TO MEDIA ══ -->
      <div v-if="showModal" class="media-viewer" @click="closeMediaModal">
        <div class="media-viewer-inner" @click.stop>
          <button type="button" class="media-viewer-close" @click.stop="closeMediaModal">Đóng</button>
          <img v-if="modalMedia?.type!=='video'" :src="modalMedia.data" alt="Ảnh phóng to" class="media-viewer-content">
          <video v-else :src="modalMedia.data" controls autoplay playsinline class="media-viewer-content"></video>
          <a
            v-if="modalMedia?.data"
            class="media-viewer-download"
            :href="modalMedia.data"
            target="_blank"
            rel="noopener noreferrer"
            download
            @click.stop
          >
            Tải xuống
          </a>
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
              <div v-if="!showCustomInput">
                <input
                  v-model="partSearchQuery"
                  type="text"
                  class="form-control mb-3"
                  placeholder="Tìm linh kiện..."
                >
                <div class="list-group">
                  <button v-for="part in filteredLinhKienList" :key="part"
                  class="list-group-item list-group-item-action"
                  :class="{ 'list-group-item-warning fw-bold': part === 'Khác' }"
                  @click="selectPart(part)">
                  {{ part === 'Khác' ? 'Khác (tự nhập)' : part }}
                  </button>
                </div>
                <div v-if="!filteredLinhKienList.length" class="text-muted small mt-3">Không tìm thấy linh kiện phù hợp.</div>
              </div>
              <div v-else>
                <p class="text-muted mb-3">Nhập tên linh kiện:</p>
                <input v-model="customPartInput" type="text" class="form-control form-control-lg mb-3"
                  placeholder="VD: Thay loa, Thay remote..." @keyup.enter="confirmCustomPart" autofocus>
                <div class="d-flex gap-2">
                  <button @click="showCustomInput = false" class="btn btn-outline-secondary flex-grow-1">← Quay lại</button>
                  <button @click="confirmCustomPart" class="btn btn-success flex-grow-1 fw-bold">Xác nhận</button>
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
              <h5 class="modal-title">Tính Hành Trình Thuận Tiện</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeRouteModal"></button>
            </div>
            <div class="modal-body">
              <div class="mb-4">
                <label class="form-label fw-bold">Địa chỉ hiện tại của bạn:</label>
                <div class="input-group">
                  <input v-model="currentLocation" type="text" class="form-control"
                    placeholder="VD: 123 Nguyễn Văn Linh, Đà Nẵng" @keyup.enter="calculateRoute">
                  <button @click="calculateRoute" :disabled="isLoadingRoute" class="btn btn-info fw-bold">
                    {{ isLoadingRoute ? 'Đang tính...' : 'Tính tuyến đường' }}
                  </button>
                </div>
              </div>
              <div v-if="currentCoords" class="alert alert-success mb-4">
                Vị trí: <strong>{{ currentCoords.displayName || `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}` }}</strong>
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
                      <div class="mb-1"><strong>SĐT:</strong> {{ item.phone }}</div>
                      <div class="mb-1"><strong>Địa chỉ:</strong> {{ item.displayAddress }}</div>
                      <small class="text-danger fw-bold">Lỗi: {{ item.issue }}</small>
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

    <button
      v-if="!showChart && isLoggedIn && !showDetailModal && !showOutsideDetailModal && !showModal && !showEditModal && !showLkForm && !showQuickCreateModal && !showOutsideForm && !showTreModal && !showRouteModal && !showChoLkTreModal && !confirmDialog.visible"
      @click="openCreateCaseModal"
      class="fab-create"
      :title="currentType === 'OUTSIDE' ? 'Tạo ca ngoài' : 'Tạo / dán ca mới'"
    >
      +
    </button>

      <!-- ══ MODAL LINH KIỆN + GIÁ (Admin) ══ -->
      <div v-if="showLkForm" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.7);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title">Linh kiện & Phí sửa chữa</h5>
              <button type="button" class="btn-close btn-close-white" @click="showLkForm = false"></button>
            </div>
            <div class="modal-body">
              <!-- Danh sách linh kiện -->
              <div v-if="editingLkItems.length" class="mb-3">
                <label class="form-label fw-bold">Linh kiện đã thêm:</label>
                <div v-for="(lk, i) in editingLkItems" :key="i" class="lk-edit-row">
                  <span class="flex-grow-1">{{ lk.name }}</span>
                  <span class="fw-bold text-success me-2">{{ formatPrice(lk.price) }}</span>
                  <button @click="removeLkItem(i)" class="btn btn-sm btn-danger">×</button>
                </div>
                <div class="lk-price-total mt-2">
                  <span>Tổng linh kiện</span>
                  <span class="fw-bold">{{ formatPrice(totalLkPrice(editingLkItems)) }}</span>
                </div>
              </div>
              <!-- Thêm linh kiện mới -->
              <div class="mb-3 p-3 bg-light rounded">
                <label class="form-label fw-bold">+ Thêm linh kiện:</label>
                <input v-model="newLkName" type="text" class="form-control mb-2" placeholder="Tên linh kiện... (VD: Board nguồn, Panel)">
                <div class="input-group mb-2">
                  <input v-model.number="newLkPrice" type="number" class="form-control" placeholder="Giá (đ)">
                  <span class="input-group-text">đ</span>
                </div>
                <button @click="addLkItem" class="btn btn-success w-100 fw-bold">+ Thêm</button>
              </div>
              <!-- Giá tổng tùy chỉnh -->
              <div class="mb-3">
                <label class="form-label fw-bold">Tổng phí thu khách (để trống = tự tính):</label>
                <div class="input-group">
                  <input v-model.number="editingPrice" type="number" class="form-control" placeholder="0">
                  <span class="input-group-text">đ</span>
                </div>
                <small class="text-muted">Tự tính: {{ formatPrice(totalLkPrice(editingLkItems)) }}</small>
              </div>
            </div>
            <div class="modal-footer">
              <button @click="showLkForm = false" class="btn btn-secondary">Hủy</button>
              <button @click="savePriceAndLk(selectedCustomer || selectedOutside)" class="btn btn-success fw-bold">Lưu</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ MODAL CA CHỜ LK TRỄ ══ -->
      <div v-if="showChoLkTreModal" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
          <div class="modal-content">
            <div class="modal-header bg-danger text-white">
              <h5 class="modal-title">Ca chờ linh kiện trễ ({{ choLkTreList.length }} ca)</h5>
              <button type="button" class="btn-close btn-close-white" @click="showChoLkTreModal = false"></button>
            </div>
            <div class="modal-body p-3">
              <div v-if="!choLkTreList.length" class="text-center text-muted py-5">Không có ca nào trễ linh kiện</div>
              <div v-else class="list-group">
                <button v-for="item in choLkTreList" :key="item.id"
                  class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-3"
                  @click="showChoLkTreModal = false; openDetailModalFull(item)">
                  <div class="flex-grow-1">
                    <div class="d-flex justify-content-between mb-1">
                      <strong class="text-primary fs-6">{{ item.ticketId }}</strong>
                      <span class="badge bg-danger">Trễ LK</span>
                    </div>
                    <div class="mb-1 fw-bold">{{ item.name }} — {{ item.phone }}</div>
                    <div class="small text-muted mb-1">Model: {{ item.model }}</div>
                    <div v-if="item.replacedPart && item.replacedPart !== 'Chưa có'" class="small text-warning fw-bold">Đang chờ: {{ item.replacedPart }}</div>
                    <div v-if="item.statusLog?.length" class="small text-muted mt-1">
                      Chuyển chờ LK: {{ [...item.statusLog].reverse().find(l=>l.status===1)?.at }}
                      bởi {{ [...item.statusLog].reverse().find(l=>l.status===1)?.by }}
                    </div>
                  </div>
                </button>
              </div>
            </div>
            <div class="modal-footer">
              <button @click="showChoLkTreModal = false" class="btn btn-secondary">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ MODAL SỬA CA ══ -->
      <div v-if="showEditModal && editingCa" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.7);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-warning text-dark">
              <h5 class="modal-title">Sửa thông tin ca</h5>
              <button type="button" class="btn-close" @click="closeEditModal"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label fw-bold">Tên khách hàng</label>
                <input v-model="editingCa.name" type="text" class="form-control" placeholder="Tên khách...">
              </div>
              <div class="mb-3">
                <label class="form-label fw-bold">Số điện thoại</label>
                <input v-model="editingCa.phone" type="tel" class="form-control" placeholder="0905...">
              </div>
              <div class="mb-3">
                <label class="form-label fw-bold">Model TV</label>
                <input v-model="editingCa.model" type="text" class="form-control" placeholder="Xiaomi TV...">
              </div>
              <div v-if="editingCaSource === 'asvn'" class="mb-3">
                <label class="form-label fw-bold">Địa chỉ</label>
                <input v-model="editingCa.address" type="text" class="form-control" placeholder="Địa chỉ...">
              </div>
              <div class="mb-3">
                <label class="form-label fw-bold">Lỗi / Tình trạng</label>
                <textarea v-model="editingCa.issue" class="form-control" rows="3" placeholder="Mô tả lỗi..."></textarea>
              </div>
              <div v-if="editingCaSource === 'asvn'" class="mb-3">
                <label class="form-label fw-bold">Serial</label>
                <input v-model="editingCa.serial" type="text" class="form-control" placeholder="Serial number...">
              </div>
              <div v-if="editingCaSource === 'asvn'" class="mb-3">
                <label class="form-label fw-bold">Kho</label>
                <select v-model="editingCa.warehouse" class="form-select">
                  <option value="TDP">Kho TDP</option>
                  <option value="NV">Kho NV</option>
                </select>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeEditModal">Hủy</button>
              <button type="button" class="btn btn-warning fw-bold" @click="saveEditCa">Lưu thay đổi</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="confirmDialog.visible" class="modal fade show" tabindex="-1" style="display:block;background:rgba(0,0,0,0.55);">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header" :class="`confirm-header confirm-header--${confirmDialog.variant}`">
              <h5 class="modal-title">{{ confirmDialog.title }}</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeConfirmDialog(false)"></button>
            </div>
            <div class="modal-body">
              <p class="mb-0">{{ confirmDialog.message }}</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeConfirmDialog(false)">{{ confirmDialog.cancelText }}</button>
              <button type="button" :class="['btn fw-bold', `btn-${confirmDialog.variant}`]" @click="closeConfirmDialog(true)">{{ confirmDialog.confirmText }}</button>
            </div>
          </div>
        </div>
      </div>

  </div>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  width: 100%;
  max-width: 100%;
  margin: 0;
  overflow-x: hidden;
}

/* ── Chart overlay ───────────────────────────────────────── */
.chart-overlay { position: fixed; inset: 0; background: #f1f5f9; z-index: 500; overflow-y: auto; }
.chart-overlay-header { background: #1e293b; padding: 0.6rem 1rem; position: sticky; top: 0; z-index: 10; }
.btn-back { background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; padding: 0.35rem 1rem; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
.btn-back:hover { background: rgba(255,255,255,0.25); }

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
  width: 100%; max-width: 100%;
  padding: 0.6rem 1.25rem; position: sticky; top: 0; z-index: 100;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  box-sizing: border-box;
  overflow-x: clip;
}
.topbar-left  { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.topbar-logo  { font-size: 1.4rem; }
.topbar-appname { font-weight: 800; font-size: 1rem; letter-spacing: -0.02em; }
.role-chip    { padding: 0.2rem 0.65rem; border-radius: 20px; font-size: 0.75rem; font-weight: 700; }
.role-admin   { background: #fef3c7; color: #92400e; }
.role-nv      { background: #dbeafe; color: #1d4ed8; }
.offline-chip { background: #fee2e2; color: #991b1b; padding: 0.2rem 0.55rem; border-radius: 20px; font-size: 0.72rem; font-weight: 700; }
.topbar-right { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.topbar-search { min-width: 260px; max-width: 320px; width: 100%; flex: 1 1 260px; }
.topbar-user  { font-size: 0.85rem; color: #94a3b8; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-topbar   { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 0.35rem 0.75rem; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all .2s; }
.btn-topbar:hover { background: rgba(255,255,255,0.2); }
.btn-topbar--active { background: #3b82f6; border-color: #3b82f6; }
.btn-topbar--alert { position: relative; }
.topbar-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 0.3rem; border-radius: 999px; background: #ef4444; color: #fff; font-size: 0.7rem; font-weight: 700; margin-left: 0.35rem; }
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
.page-wrap { min-height: 100vh; width: 100%; max-width: 100vw; overflow-x: hidden; background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); font-family: system-ui, -apple-system, sans-serif; }
.layout { width: 100%; max-width: 1450px; margin: 0 auto; padding: 1.5rem 1rem; display: flex; flex-direction: column; gap: 1.5rem; box-sizing: border-box; }
.control-card, .cases-section { background: #fff; border-radius: 20px; padding: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,.05), 0 2px 4px -1px rgba(0,0,0,.1); border: 1px solid #e2e8f0; }
.control-card--sticky { position: sticky; top: 64px; z-index: 40; }
.control-card { transition: padding .22s ease, border-radius .22s ease, box-shadow .22s ease; }
.control-card-expand,
.control-card-collapse {
  display: none;
}
.filter-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.filter-summary { min-width: 0; }
.filter-title { font-size: 1rem; font-weight: 800; color: #0f172a; }
.filter-meta-text { color: #64748b; font-size: 0.85rem; }
.filter-button { white-space: nowrap; }
.filter-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1rem; margin-bottom: 1rem; }
.filter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
.filter-field { display: flex; flex-direction: column; gap: 0.35rem; }
.filter-label { font-size: 0.82rem; font-weight: 700; color: #475569; }

/* ── Buttons/Toggles ──────────────────────────────────────── */
.toggle-row, .status-toggle-row, .warehouse-toggle-row { display: flex; gap: 0.75rem; margin-bottom: 1rem; }
.status-toggle-row--sticky { position: sticky; top: 0; z-index: 5; background: #fff; padding-top: 0.25rem; }
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
.control-body-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.85rem; }
.control-body-title { font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.control-body-note { font-size: 0.82rem; color: #64748b; }
.control-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; margin-top: 1rem; }
.control-actions input { grid-column: span 3; padding: 0.875rem; font-size: 1rem; }
.control-subfilters { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin-top: 0.85rem; }

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
.case-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.85rem; }
.case-ticket { font-size: 1.02rem; font-weight: 800; letter-spacing: -0.02em; }
.case-main { display: flex; flex-direction: column; gap: 0.45rem; }
.case-primary { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.case-customer { font-size: 1.08rem; font-weight: 800; color: #111827; }
.case-phone { font-size: 0.95rem; font-weight: 700; color: #475569; }
.case-model { color: #0f172a; font-weight: 700; }
.case-issue { color: #dc2626; font-weight: 800; line-height: 1.35; }
.case-meta { color: #64748b; font-size: 0.9rem; }
.case-part { color: #0369a1; font-size: 0.92rem; font-weight: 700; }
.status-editor { background: #f8fafc; border: 1px solid #dbe3ef; border-radius: 12px; padding: 0.9rem; }
.status-editor-row { display: flex; gap: 0.65rem; align-items: center; }
.detail-tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; overflow-x: auto; }
.detail-tab-btn { border: 1px solid #cbd5e1; background: #f8fafc; color: #475569; border-radius: 999px; padding: 0.45rem 0.9rem; font-weight: 700; font-size: 0.85rem; }
.detail-tab-btn--active { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
.fab-create { position: fixed; right: 1rem; bottom: 1rem; width: 58px; height: 58px; border: none; border-radius: 50%; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; font-size: 2rem; line-height: 1; box-shadow: 0 14px 28px rgba(37,99,235,.28); z-index: 120; display: inline-flex; align-items: center; justify-content: center; }
.fab-create:hover { transform: translateY(-2px); box-shadow: 0 18px 32px rgba(37,99,235,.34); }

/* ── Media grid ───────────────────────────────────────────── */
.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 0.75rem; margin: 1rem 0; }
.media-item { position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; }
.media-item img, .media-item video { width: 100%; height: 100%; object-fit: cover; cursor: pointer; }
.media-del { position: absolute; top: 4px; right: 4px; background: #ef4444; color: #fff; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 16px; cursor: pointer; z-index: 10; font-weight: bold; box-shadow: 0 2px 6px rgba(0,0,0,0.3); border: 2px solid #fff; }
.media-add { aspect-ratio: 1; border: 2px dashed #cbd5e0; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #94a3b8; font-size: 24px; transition: all .2s; }
.media-add:hover { border-color: #3b82f6; background: #eff6ff; color: #3b82f6; }
.warehouse-badge { color: #0f172a; background: #e2e8f0; border: 1px solid #cbd5e1; }
.warehouse-badge--tdp { background: #e2e8f0; border-color: #cbd5e1; }
.warehouse-badge--nv { background: #f1f5f9; border-color: #cbd5e1; }
.confirm-header { color: #fff; }
.confirm-header--primary { background: #2563eb; }
.confirm-header--success { background: #059669; }
.confirm-header--warning { background: #d97706; }
.confirm-header--danger { background: #dc2626; }

/* ── Date pill ────────────────────────────────────────────── */
.date-pill { background: linear-gradient(135deg, #10b981, #059669); color: #fff; padding: 0.5rem 1rem; border-radius: 20px; font-weight: 600; font-size: 0.9rem; }

/* ── Media modal ──────────────────────────────────────────── */
.media-viewer {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(2, 6, 23, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.media-viewer-inner {
  position: relative;
  width: min(100%, 980px);
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-viewer-content {
  display: block;
  max-width: 100%;
  max-height: 82vh;
  border-radius: 22px;
  background: #0f172a;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.35);
}

.media-viewer-close {
  position: absolute;
  top: 18px;
  right: 18px;
  border: 0;
  border-radius: 999px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  z-index: 1;
}

.media-viewer-download {
  position: absolute;
  right: 18px;
  bottom: 18px;
  border-radius: 999px;
  padding: 10px 16px;
  background: rgba(15, 23, 42, 0.82);
  color: #fff;
  text-decoration: none;
  font-weight: 700;
}

/* ── Misc ─────────────────────────────────────────────────── */
.modal-xl { max-width: 1100px; }
.btn-close-white { filter: invert(1); }
.text-danger { color: #ef4444 !important; }
.text-info   { color: #0ea5e9 !important; }
@keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }

/* ── Responsive ───────────────────────────────────────────── */
@media (max-width: 480px) {
  .topbar { padding: 0 0.6rem; height: 50px; flex-wrap: nowrap; }
  .topbar-left { gap: 0.35rem; flex-shrink: 0; min-width: 0; }
  .topbar-logo { font-size: 1.1rem; }
  .topbar-appname { font-size: 0.8rem; }
  .role-chip { font-size: 0.62rem; padding: 0.12rem 0.4rem; }
  .topbar-user { display: none; }
  .topbar-right { gap: 0.3rem; flex: 1; justify-content: flex-end; }
  .topbar-search { min-width: 0; max-width: none; flex: 1 1 0; font-size: 0.8rem; padding: 0.35rem 0.55rem; }
  .btn-topbar { padding: 0.3rem 0.45rem; font-size: 1rem; border-radius: 6px; white-space: nowrap; min-width: 36px; }
  .btn-text { display: none; }
  .topbar-badge { margin-left: 0; position: absolute; top: -5px; right: -5px; }
  .tab-label { display: none; }
  .status-toggle-row button { font-size: 0.85rem; padding: 0.6rem 0.4rem; }
  .modal-dialog { margin: 0.5rem; max-width: calc(100% - 1rem); }
  .media-viewer { padding: 16px 10px 76px; }
  .media-viewer-content { max-height: 72vh; border-radius: 16px; }
  .media-viewer-close { top: 12px; right: 12px; padding: 8px 12px; }
  .media-viewer-download { right: 12px; bottom: 12px; left: 12px; text-align: center; }
}
@media (max-width: 768px) {
  .layout { width: 100%; max-width: 100%; padding: 1rem 0.5rem; gap: 1rem; }
  .control-card, .cases-section { padding: 1rem; border-radius: 16px; }
  .control-card--sticky { top: 56px; }
  .control-card--mobile-collapsed { padding: 0.7rem 0.85rem; border-radius: 14px; box-shadow: 0 8px 18px rgba(15,23,42,.1); }
  .control-card--mobile-collapsed .filter-toolbar { margin-bottom: 0.5rem; }
  .control-card--mobile-collapsed .filter-title { font-size: 0.92rem; }
  .control-card--mobile-collapsed .filter-meta-text { font-size: 0.78rem; }
  .control-card--mobile-collapsed .filter-button { padding: 0.45rem 0.7rem; font-size: 0.78rem; }
  .control-card--mobile-collapsed .status-toggle-row { margin-bottom: 0; }
  .control-card--mobile-collapsed .status-toggle-row button { min-height: 44px; padding: 0.45rem 0.35rem; }
  .control-card-expand,
  .control-card-collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    margin-top: 0.6rem;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #334155;
    border-radius: 10px;
    padding: 0.55rem 0.8rem;
    font-size: 0.82rem;
    font-weight: 700;
  }
  .filter-grid { grid-template-columns: 1fr; }
  .toggle-row, .status-toggle-row { gap: 0.5rem; }
  .toggle-row button, .status-toggle-row button { flex: 1; padding: 0.75rem 0.5rem; font-size: 0.85rem; }
  .warehouse-toggle-row { flex-direction: column; align-items: stretch; }
  .warehouse-buttons { flex-direction: row; }
  .control-actions { grid-template-columns: 1fr 1fr; }
  .control-actions input { grid-column: span 2; }
  .case-strip { grid-template-columns: 1fr; }
  .section-title { font-size: 1.25rem; }
  .toast-container { max-width: calc(100vw - 2rem); }
  .case-primary { flex-direction: column; align-items: flex-start; gap: 0.2rem; }
  .status-editor-row { flex-direction: column; align-items: stretch; }
  .control-body-header { align-items: flex-start; }
  .control-subfilters { grid-template-columns: 1fr; }
  .fab-create { right: 0.75rem; bottom: 0.75rem; width: 54px; height: 54px; }
}
@media (min-width: 1200px) {
  .case-strip { grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); }
}
/* ── Status Log ───────────────────────────────────────────── */
.status-log { display: flex; flex-direction: column; gap: 0.4rem; }
.status-log-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; }
.log-badge { padding: 0.15rem 0.6rem; border-radius: 20px; font-weight: 700; font-size: 0.75rem; white-space: nowrap; }
.log-blue   { background: #dbeafe; color: #1d4ed8; }
.log-yellow { background: #fef3c7; color: #92400e; }
.log-green  { background: #d1fae5; color: #065f46; }
.log-meta   { color: #64748b; }

/* ── Swipe card ───────────────────────────────────────────── */
.swipe-card { position: relative; overflow: hidden; transition: transform .28s cubic-bezier(.22,1,.36,1), box-shadow .28s ease; will-change: transform; }
.swipe-hint-right,
.swipe-hint-left {
  position: absolute; top: 50%; transform: translateY(-50%);
  background: rgba(0,0,0,0.55); color: #fff;
  padding: 0.4rem 0.8rem; border-radius: 8px;
  font-size: 0.85rem; font-weight: 700;
  opacity: 0; pointer-events: none; z-index: 5;
  transition: opacity 0.2s;
}
.swipe-hint-right { left: 12px; }
.swipe-hint-left  { right: 12px; }
.swipe-card:active .swipe-hint-right,
.swipe-card:active .swipe-hint-left { opacity: 1; }

/* ── Price block ──────────────────────────────────────────── */
.price-block { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 0.75rem 1rem; }
.warranty-block { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 0.75rem 1rem; }
.warranty-summary { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; color: #1e3a8a; }
.warranty-actions { margin-top: 0.75rem; }
.lk-price-list { display: flex; flex-direction: column; gap: 0.3rem; }
.lk-price-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.2rem 0; border-bottom: 1px solid #dcfce7; }
.lk-price-total { display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700; color: #065f46; padding-top: 0.3rem; border-top: 2px solid #86efac; }
.price-display { display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; }
.price-value { font-size: 1.3rem; font-weight: 800; color: #16a34a; }
.lk-edit-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0; border-bottom: 1px solid #e5e7eb; font-size: 0.9rem; }
</style>
