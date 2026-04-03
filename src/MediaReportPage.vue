<script setup>
import { computed, ref } from 'vue'
import * as XLSX from 'xlsx'
import { deleteMediaReport, loadMediaReport } from './lib/mediaReportStore'

const report = ref(null)
const loadError = ref('')

const formatDateTime = (value) => {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('vi-VN')
}

const getReportId = () => new URLSearchParams(window.location.search).get('report') || ''

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
const reportTitle = computed(() => report.value?.title || 'Bao cao media')
const reportCreatedAt = computed(() => formatDateTime(report.value?.createdAt))
const totalMedia = computed(() => reportItems.value.reduce((sum, entry) => sum + (entry.media?.length || 0), 0))

const exportExcel = () => {
  if (!reportItems.value.length) return
  const summaryRows = reportItems.value.map(({ item, media }) => ({
    'Ma ca': item.ticketId || '',
    'Khach hang': item.name || '',
    'SDT': item.phone || '',
    'Model': item.model || '',
    'Ngay hoan thanh': item.doneDate || '',
    'Kho': item.warehouse || '',
    'Loi': item.issue || '',
    'Linh kien thay': item.replacedPart || '',
    'Dia chi': item.address || '',
    'So media': media?.length || 0,
  }))

  const mediaRows = reportItems.value.flatMap(({ item, media }) => {
    if (!media?.length) {
      return [{
        'Ma ca': item.ticketId || '',
        'Khach hang': item.name || '',
        'Loai': 'Khong co',
        'Link media': '',
      }]
    }
    return media.map((entry, index) => ({
      'Ma ca': item.ticketId || '',
      'Khach hang': item.name || '',
      'Loai': entry?.type === 'video' ? `Video ${index + 1}` : `Anh ${index + 1}`,
      'Link media': entry?.data || '',
    }))
  })

  const workbook = XLSX.utils.book_new()
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows)
  const mediaSheet = XLSX.utils.json_to_sheet(mediaRows)

  mediaRows.forEach((row, index) => {
    if (!row['Link media']) return
    const cellRef = XLSX.utils.encode_cell({ r: index + 1, c: 3 })
    if (!mediaSheet[cellRef]) mediaSheet[cellRef] = { t: 's', v: row['Link media'] }
    mediaSheet[cellRef].l = { Target: row['Link media'] }
  })

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Tong hop')
  XLSX.utils.book_append_sheet(workbook, mediaSheet, 'Media')
  XLSX.writeFile(workbook, `${reportTitle.value}.xlsx`)
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
            Bao cao tao luc {{ reportCreatedAt }}. Hien thi truc tiep anh va video cua tung ca.
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
            <span class="media-report-metric-label">Tong media</span>
            <strong>{{ totalMedia }}</strong>
          </div>
        </section>

        <section class="media-report-list">
          <article v-for="entry in reportItems" :key="entry.item.id || entry.item.ticketId" class="media-report-card">
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

            <div v-if="entry.media?.length" class="media-report-grid">
              <figure v-for="(media, mediaIndex) in entry.media" :key="`${entry.item.id || entry.item.ticketId}-${mediaIndex}`" class="media-report-media">
                <img
                  v-if="media.type !== 'video'"
                  :src="media.data"
                  :alt="`Anh ${mediaIndex + 1}`"
                  loading="lazy"
                  decoding="async"
                >
                <video
                  v-else
                  :src="media.data"
                  controls
                  preload="metadata"
                  playsinline
                ></video>
                <figcaption>
                  {{ media.type === 'video' ? `Video ${mediaIndex + 1}` : `Anh ${mediaIndex + 1}` }}
                  <a :href="media.data" target="_blank" rel="noopener">
                    {{ media.type === 'video' ? 'Mo video' : 'Mo anh' }}
                  </a>
                </figcaption>
              </figure>
            </div>
            <div v-else class="media-report-empty media-report-empty--inline">
              Khong co anh/video
            </div>
          </article>
        </section>
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

.media-report-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.media-report-media {
  margin: 0;
  padding: 10px;
  border-radius: 20px;
  border: 1px solid #d6e3f6;
  background: #f7fbff;
}

.media-report-media img,
.media-report-media video {
  width: 100%;
  height: 240px;
  object-fit: cover;
  border-radius: 14px;
  display: block;
  background: #dce7f6;
}

.media-report-media figcaption {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  color: #314766;
  font-size: 14px;
}

.media-report-media a {
  color: #1258bc;
  font-weight: 700;
  text-decoration: none;
}

.media-report-empty {
  border-radius: 24px;
  padding: 28px;
  text-align: center;
}

.media-report-empty--inline {
  padding: 20px;
}

@media (max-width: 768px) {
  .media-report-shell {
    padding: 16px 12px 30px;
  }

  .media-report-hero,
  .media-report-card-head {
    flex-direction: column;
  }

  .media-report-actions {
    width: 100%;
    justify-content: stretch;
  }

  .media-report-btn {
    width: 100%;
  }

  .media-report-card {
    padding: 16px;
    border-radius: 22px;
  }

  .media-report-card-head h2 {
    font-size: 24px;
  }

  .media-report-grid {
    grid-template-columns: 1fr;
  }

  .media-report-media img,
  .media-report-media video {
    height: 260px;
  }

  .media-report-media figcaption {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
