<script setup>
import { computed, ref } from 'vue'
import * as XLSX from 'xlsx'
import { getSupabase } from './lib/supabase'
import { deleteMediaReport, loadMediaReport } from './lib/mediaReportStore'

const BUCKET = 'media'
const PAGE_SIZE = 15
const report = ref(null)
const loadError = ref('')
const mediaState = ref({})
const visibleCount = ref(PAGE_SIZE)
const activeMedia = ref(null)

const formatDateTime = (value) => {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('vi-VN')
}

const getReportId = () => new URLSearchParams(window.location.search).get('report') || ''

const getPublicUrl = (path) => {
  const { data } = getSupabase().storage.from(BUCKET).getPublicUrl(path)
  return data?.publicUrl || ''
}

const normalizeMediaList = (media) => {
  if (!Array.isArray(media)) return []
  return media.map((entry) => {
    if (!entry) return null
    if (typeof entry === 'string') {
      return {
        type: 'image',
        data: /^https?:\/\//i.test(entry) ? entry : getPublicUrl(entry),
      }
    }
    if (entry?.source === 'storage' && entry?.path) {
      return {
        type: entry.type === 'video' ? 'video' : 'image',
        data: getPublicUrl(entry.path),
      }
    }
    if (entry?.path && !entry?.data) {
      return {
        type: entry.type === 'video' ? 'video' : 'image',
        data: getPublicUrl(entry.path),
      }
    }
    if (entry?.data) {
      return {
        type: entry.type === 'video' ? 'video' : 'image',
        data: entry.data,
      }
    }
    return null
  }).filter(Boolean)
}

const loadReport = async () => {
  const reportId = getReportId()
  if (!reportId) {
    loadError.value = 'Khong tim thay ma bao cao.'
    return
  }
  try {
    const data = await loadMediaReport(reportId)
    if (!data) {
      loadError.value = 'Bao cao da het han hoac chua duoc tao.'
      return
    }
    report.value = data
  } catch (error) {
    console.error('[MediaReport] Load report failed', error)
    loadError.value = 'Khong doc duoc du lieu bao cao.'
  }
}

loadReport()

const reportItems = computed(() => report.value?.items || [])
const visibleItems = computed(() => reportItems.value.slice(0, visibleCount.value))
const reportTitle = computed(() => report.value?.title || 'Bao cao media')
const reportCreatedAt = computed(() => formatDateTime(report.value?.createdAt))
const totalMedia = computed(() => reportItems.value.reduce((sum, entry) => sum + (entry.item?.mediaCount || 0), 0))
const hasMoreItems = computed(() => visibleCount.value < reportItems.value.length)

const getEntryState = (itemId) => mediaState.value[itemId] || { open: false, loading: false, loaded: false, media: [], error: '' }

const setEntryState = (itemId, patch) => {
  mediaState.value = {
    ...mediaState.value,
    [itemId]: {
      ...getEntryState(itemId),
      ...patch,
    },
  }
}

const loadMediaLinks = async (itemId) => {
  setEntryState(itemId, { loading: true, error: '', open: true })
  try {
    const { data, error } = await getSupabase()
      .from('customers')
      .select('media')
      .eq('id', itemId)
      .maybeSingle()
    if (error) throw error
    const media = normalizeMediaList(data?.media)
    setEntryState(itemId, {
      loading: false,
      loaded: true,
      open: true,
      media,
      error: '',
    })
  } catch (error) {
    console.error('[MediaReport] Load media failed', error)
    setEntryState(itemId, {
      loading: false,
      loaded: true,
      open: true,
      media: [],
      error: 'Khong tai duoc link media.',
    })
  }
}

const toggleMedia = async (itemId) => {
  const current = getEntryState(itemId)
  if (current.open) {
    setEntryState(itemId, { open: false })
    return
  }
  if (current.loaded) {
    setEntryState(itemId, { open: true })
    return
  }
  await loadMediaLinks(itemId)
}

const exportExcel = () => {
  if (!reportItems.value.length) return
  const summaryRows = reportItems.value.map(({ item }) => ({
    'Ma ca': item.ticketId || '',
    'Khach hang': item.name || '',
    'SDT': item.phone || '',
    'Model': item.model || '',
    'Ngay hoan thanh': item.doneDate || '',
    'Kho': item.warehouse || '',
    'Loi': item.issue || '',
    'Linh kien thay': item.replacedPart || '',
    'Dia chi': item.address || '',
  }))

  const workbook = XLSX.utils.book_new()
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows)
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Tong hop')
  XLSX.writeFile(workbook, `${reportTitle.value}.xlsx`)
}

const loadMoreItems = () => {
  visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, reportItems.value.length)
}

const openMediaViewer = (media) => {
  activeMedia.value = media
  document.body.style.overflow = 'hidden'
}

const closeMediaViewer = () => {
  activeMedia.value = null
  document.body.style.overflow = ''
}

const goBackHome = () => {
  const reportId = getReportId()
  if (reportId) {
    deleteMediaReport(reportId).catch(() => {})
  }
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  window.location.href = '/'
}
</script>

<template>
  <div class="media-report-page">
    <div class="media-report-shell">
      <header class="media-report-hero">
        <div>
          <div class="media-report-kicker">ASVN MEDIA REPORT</div>
          <h1>{{ reportTitle }}</h1>
          <p v-if="reportCreatedAt" class="media-report-subtitle">
            Bao cao tao luc {{ reportCreatedAt }}. Mo nhanh danh sach ca, can xem media thi bam tung ca de tai link rieng.
          </p>
        </div>
        <div class="media-report-actions">
          <button class="media-report-btn media-report-btn--primary" @click="exportExcel">
            Xuat thanh file exel
          </button>
          <button class="media-report-btn media-report-btn--ghost" @click="goBackHome">
            Quay lai trang chu
          </button>
        </div>
      </header>

      <section v-if="loadError" class="media-report-empty">
        <h2>Khong mo duoc bao cao</h2>
        <p>{{ loadError }}</p>
      </section>

      <template v-else>
        <section class="media-report-summary">
          <div class="media-report-metric">
            <span class="media-report-metric-label">So ca</span>
            <strong>{{ reportItems.length }}</strong>
          </div>
          <div class="media-report-metric">
            <span class="media-report-metric-label">Dang hien</span>
            <strong>{{ visibleItems.length }}</strong>
          </div>
          <div class="media-report-metric">
            <span class="media-report-metric-label">Tong media</span>
            <strong>{{ totalMedia }}</strong>
          </div>
        </section>

        <section class="media-report-list">
          <article v-for="entry in visibleItems" :key="entry.item.id || entry.item.ticketId" class="media-report-card">
            <div class="media-report-card-head">
              <div>
                <h2>{{ entry.item.ticketId || 'Khong ro ma ca' }}</h2>
                <p>{{ entry.item.name || 'Khach le' }}<span v-if="entry.item.phone"> • {{ entry.item.phone }}</span></p>
              </div>
              <span class="media-report-badge">
                {{ entry.item.warehouse || (entry.item.ticketId?.startsWith('NGOAI') ? 'Ca ngoai' : 'Khong ro kho') }}
              </span>
            </div>

            <div class="media-report-info">
              <div><strong>Ngay hoan thanh:</strong> {{ entry.item.doneDate || 'Chua cap nhat' }}</div>
              <div><strong>Model:</strong> {{ entry.item.model || 'Chua cap nhat' }}</div>
              <div><strong>Loi:</strong> {{ entry.item.issue || 'Chua cap nhat' }}</div>
              <div><strong>Linh kien thay:</strong> {{ entry.item.replacedPart || 'Chua co' }}</div>
              <div><strong>Dia chi:</strong> {{ entry.item.address || 'Chua cap nhat' }}</div>
            </div>

            <div class="media-report-tools">
              <div class="media-report-count">
                {{ entry.item.mediaCount || 0 }} media
              </div>
              <button class="media-report-toggle" @click="toggleMedia(entry.item.id)">
                {{ getEntryState(entry.item.id).open ? 'An media' : 'Xem media' }}
              </button>
            </div>

            <div v-if="getEntryState(entry.item.id).open" class="media-report-panel">
              <div v-if="getEntryState(entry.item.id).loading" class="media-report-empty media-report-empty--inline">
                Dang tai link media...
              </div>
              <div v-else-if="getEntryState(entry.item.id).error" class="media-report-empty media-report-empty--inline">
                {{ getEntryState(entry.item.id).error }}
              </div>
              <div v-else-if="getEntryState(entry.item.id).media.length" class="media-report-links">
                <a
                  v-for="(media, mediaIndex) in getEntryState(entry.item.id).media"
                  :key="`${entry.item.id || entry.item.ticketId}-${mediaIndex}`"
                  class="media-report-link"
                  href="#"
                  @click.prevent="openMediaViewer(media)"
                >
                  <span>{{ media.type === 'video' ? `Video ${mediaIndex + 1}` : `Anh ${mediaIndex + 1}` }}</span>
                  <small>{{ media.data }}</small>
                </a>
              </div>
              <div v-else class="media-report-empty media-report-empty--inline">
                Khong co anh/video
              </div>
            </div>
          </article>
        </section>

        <div v-if="hasMoreItems" class="media-report-loadmore">
          <button class="media-report-btn media-report-btn--ghost" @click="loadMoreItems">
            Xem them 15 ca
          </button>
        </div>

        <div v-if="activeMedia" class="media-viewer" @click="closeMediaViewer">
          <div class="media-viewer-inner" @click.stop>
            <button type="button" class="media-viewer-close" @click="closeMediaViewer">Back</button>
            <img v-if="activeMedia.type !== 'video'" :src="activeMedia.data" alt="Anh media" class="media-viewer-content">
            <video v-else :src="activeMedia.data" controls autoplay playsinline class="media-viewer-content"></video>
            <a
              class="media-viewer-download"
              :href="activeMedia.data"
              target="_blank"
              rel="noopener"
              download
            >
              Tai xuong
            </a>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.media-report-page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(27, 111, 229, 0.16), transparent 36%),
    linear-gradient(180deg, #eef6ff 0%, #f8fbff 58%, #edf3fb 100%);
  color: #17223b;
}

.media-report-shell {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 16px 40px;
}

.media-report-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.media-report-kicker {
  color: #1086b8;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.12em;
  margin-bottom: 6px;
}

.media-report-hero h1 {
  margin: 0;
  font-size: clamp(28px, 5vw, 46px);
  line-height: 1.04;
}

.media-report-subtitle {
  margin: 10px 0 0;
  max-width: 720px;
  color: #4f6484;
  font-size: 16px;
}

.media-report-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.media-report-btn {
  border: 0;
  border-radius: 999px;
  padding: 14px 18px;
  font-weight: 800;
  font-size: 15px;
  cursor: pointer;
}

.media-report-btn--primary {
  background: linear-gradient(135deg, #2478f0, #145dc7);
  color: #fff;
}

.media-report-btn--ghost {
  background: #e3eefb;
  color: #1c3558;
}

.media-report-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.media-report-metric,
.media-report-card,
.media-report-empty {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #d6e3f6;
  box-shadow: 0 18px 36px rgba(41, 69, 113, 0.1);
}

.media-report-metric {
  border-radius: 20px;
  padding: 18px;
}

.media-report-metric-label {
  display: block;
  color: #67809f;
  font-size: 13px;
  margin-bottom: 6px;
}

.media-report-metric strong {
  font-size: 32px;
}

.media-report-list {
  display: grid;
  gap: 18px;
}

.media-report-loadmore {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

.media-report-card {
  border-radius: 28px;
  padding: 18px;
}

.media-report-card-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.media-report-card-head h2 {
  margin: 0 0 6px;
  color: #145dc7;
  font-size: 28px;
}

.media-report-card-head p {
  margin: 0;
  color: #5d7291;
}

.media-report-badge {
  background: #e6f0fe;
  color: #1258bc;
  border-radius: 999px;
  padding: 8px 14px;
  font-weight: 800;
  white-space: nowrap;
}

.media-report-info {
  display: grid;
  gap: 8px;
  color: #22314d;
  margin-bottom: 16px;
}

.media-report-tools {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.media-report-count {
  color: #5d7291;
  font-weight: 700;
}

.media-report-toggle {
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  background: #145dc7;
  color: #fff;
  font-weight: 800;
  cursor: pointer;
}

.media-report-panel {
  margin-top: 8px;
}

.media-report-links {
  display: grid;
  gap: 12px;
}

.media-report-link {
  display: block;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid #d6e3f6;
  background: #f7fbff;
  color: #314766;
  font-size: 14px;
  text-decoration: none;
}

.media-report-link span {
  display: block;
  font-weight: 800;
  margin-bottom: 4px;
}

.media-report-link small {
  display: block;
  color: #5d7291;
  word-break: break-all;
}

.media-report-link:hover {
  border-color: #9bbaf0;
  background: #eef5ff;
}

.media-report-link:visited {
  color: #1258bc;
}

.media-report-empty {
  border-radius: 24px;
  padding: 28px;
  text-align: center;
}

.media-report-empty--inline {
  padding: 20px;
}

.media-viewer {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(15, 23, 42, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.media-viewer-inner {
  position: relative;
  width: min(100%, 960px);
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-viewer-content {
  max-width: 100%;
  max-height: 78vh;
  border-radius: 18px;
  background: #0f172a;
  display: block;
}

.media-viewer-close {
  position: absolute;
  top: -12px;
  left: 0;
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-weight: 800;
  cursor: pointer;
}

.media-viewer-download {
  position: absolute;
  right: 0;
  bottom: -14px;
  border-radius: 999px;
  padding: 10px 16px;
  background: #2563eb;
  color: #fff;
  font-weight: 800;
  text-decoration: none;
}

@media (max-width: 768px) {
  .media-report-shell {
    padding: 16px 12px 30px;
  }

  .media-report-hero,
  .media-report-card-head,
  .media-report-tools {
    flex-direction: column;
    align-items: stretch;
  }

  .media-report-actions {
    width: 100%;
    justify-content: stretch;
  }

  .media-report-btn,
  .media-report-toggle {
    width: 100%;
  }

  .media-report-card {
    padding: 16px;
    border-radius: 22px;
  }

  .media-report-card-head h2 {
    font-size: 24px;
  }

  .media-report-link {
    padding: 12px 14px;
  }

  .media-viewer {
    padding: 16px 10px 76px;
  }

  .media-viewer-content {
    max-height: 72vh;
    border-radius: 16px;
  }

  .media-viewer-close {
    top: 12px;
    left: 12px;
  }

  .media-viewer-download {
    right: 12px;
    bottom: 12px;
    left: 12px;
    text-align: center;
  }
}
</style>
