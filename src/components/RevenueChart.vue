<script setup>
import { ref, computed, onMounted } from 'vue'
import { getSupabase } from '@/lib/supabase'

const supabase  = getSupabase()
const allData   = ref([])
const isLoading = ref(true)
const viewMode  = ref('month')
const selectedYear  = ref(new Date().getFullYear())
const selectedMonth = ref(new Date().getMonth() + 1)

const props = defineProps({
  dangLamAll: { type: Number, default: 0 },
  choLKAll:   { type: Number, default: 0 },
  tongTat:    { type: Number, default: 0 },
  choLkTre:   { type: Number, default: 0 },
})

const years  = computed(() => { const y = new Date().getFullYear(); return [y-1, y].filter(x => x >= 2024) })
const months = Array.from({ length: 12 }, (_, i) => ({ v: i+1, l: `T${i+1}` }))

const fmt     = (n) => { if (!n) return '0'; if (n >= 1e6) return (n/1e6).toFixed(1).replace('.0','')+'tr'; if (n >= 1e3) return (n/1e3).toFixed(0)+'k'; return n+'' }
const fmtFull = (n) => Number(n||0).toLocaleString('vi-VN')+'đ'

onMounted(async () => {
  const { data } = await supabase
    .from('customers')
    .select('id, price, lkItems, doneDate, ticketId, name, model, warehouse, status, replacedPart')
    .eq('status', 2).not('doneDate','is',null)
  allData.value = data || []
  isLoading.value = false
})

const parseDate = (s) => {
  if (!s) return null
  const m = s.match(/(\d+)\/(\d+)\/(\d+)/)
  return m ? { d:+m[1], mo:+m[2], y:+m[3] } : null
}

// Tháng: chỉ lấy ngày có ca (không bị thưa)
const monthlyData = computed(() => {
  const map = new Map()
  allData.value.forEach(c => {
    const pd = parseDate(c.doneDate)
    if (!pd || pd.mo !== selectedMonth.value || pd.y !== selectedYear.value) return
    const key = `${pd.d}/${selectedMonth.value}`
    if (!map.has(key)) map.set(key, { label: key, shortLabel: `${pd.d}`, day: pd.d, revenue: 0, count: 0, items: [] })
    const b = map.get(key)
    b.revenue += c.price||0; b.count++; b.items.push(c)
  })
  return [...map.values()].sort((a,b) => a.day - b.day)
})

// Năm: 12 tháng
const yearlyData = computed(() => {
  const arr = Array.from({ length: 12 }, (_,i) => ({ label:`T${i+1}`, shortLabel:`T${i+1}`, mo:i+1, revenue:0, count:0, items:[] }))
  allData.value.forEach(c => {
    const pd = parseDate(c.doneDate)
    if (!pd || pd.y !== selectedYear.value) return
    arr[pd.mo-1].revenue += c.price||0; arr[pd.mo-1].count++; arr[pd.mo-1].items.push(c)
  })
  return arr
})

const chartData  = computed(() => viewMode.value === 'month' ? monthlyData.value : yearlyData.value)
const hasRevenue = computed(() => chartData.value.some(d => d.revenue > 0))
const maxRev     = computed(() => Math.max(...chartData.value.map(d => d.revenue), 1))
const totalRev   = computed(() => chartData.value.reduce((s,d) => s+d.revenue, 0))
const totalCount = computed(() => chartData.value.reduce((s,d) => s+d.count, 0))

const topCa = computed(() =>
  [...allData.value]
    .filter(c => {
      const pd = parseDate(c.doneDate); if (!pd) return false
      if (viewMode.value==='year') return pd.y===selectedYear.value
      return pd.y===selectedYear.value && pd.mo===selectedMonth.value
    })
    .filter(c => (c.price||0) > 0)
    .sort((a,b) => (b.price||0)-(a.price||0))
    .slice(0,5)
)

const tooltip = ref(null)
const showTip = (e, bar) => {
  tooltip.value = { x: e.clientX, y: e.clientY, bar }
}
const hideTip = () => tooltip.value = null
</script>

<template>
  <div class="rc-page">

    <!-- Header -->
    <div class="rc-head">
      <div>
        <h1 class="rc-title">Doanh thu</h1>
        <p class="rc-sub">{{ viewMode==='month' ? `Tháng ${selectedMonth}/${selectedYear}` : `Năm ${selectedYear}` }}</p>
      </div>
      <div class="rc-controls">
        <div class="seg">
          <button :class="['seg-btn', viewMode==='month'&&'seg-on']" @click="viewMode='month'">Tháng</button>
          <button :class="['seg-btn', viewMode==='year'&&'seg-on']"  @click="viewMode='year'">Năm</button>
        </div>
        <select v-if="viewMode==='month'" v-model.number="selectedMonth" class="rc-sel">
          <option v-for="m in months" :key="m.v" :value="m.v">{{ m.l }}</option>
        </select>
        <select v-model.number="selectedYear" class="rc-sel">
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>
    </div>

    <div v-if="isLoading" class="rc-loading"><div class="spin"></div></div>

    <template v-else>

      <!-- Status pills -->
      <div class="pill-row">
        <div class="pill pill-b">⚡ <b>{{ props.dangLamAll }}</b> đang làm</div>
        <div class="pill pill-y">⏳ <b>{{ props.choLKAll }}</b> chờ LK</div>
        <div class="pill pill-g">🏁 <b>{{ props.tongTat }}</b> tổng xong</div>
        <div v-if="props.choLkTre > 0" class="pill pill-r">⏰ <b>{{ props.choLkTre }}</b> trễ LK</div>
      </div>

      <!-- KPI -->
      <div class="kpi-row">
        <div class="kpi kpi-green">
          <div class="kpi-icon">💰</div>
          <div class="kpi-val">{{ fmtFull(totalRev) }}</div>
          <div class="kpi-lbl">Doanh thu kỳ này</div>
        </div>
        <div class="kpi-pair">
          <div class="kpi kpi-blue">
            <div class="kpi-val">{{ totalCount }}</div>
            <div class="kpi-lbl">✅ Ca xong</div>
          </div>
          <div class="kpi kpi-teal">
            <div class="kpi-val">{{ totalCount ? fmt(Math.round(totalRev/totalCount)) : '0' }}đ</div>
            <div class="kpi-lbl">📊 TB/ca</div>
          </div>
        </div>
      </div>

      <!-- Chart -->
      <div class="chart-card">
        <div class="chart-title-row">
          <span class="chart-label">Biểu đồ doanh thu theo {{ viewMode==='month'?'ngày':'tháng' }}</span>
          <span v-if="!hasRevenue" class="no-rev-tag">Chưa nhập giá tiền</span>
        </div>

        <div v-if="chartData.length === 0" class="chart-empty">Chưa có ca hoàn thành kỳ này</div>
        <div v-else class="chart-area">
          <!-- Y labels -->
          <div class="y-labels">
            <span>{{ fmt(maxRev) }}</span>
            <span>{{ fmt(Math.round(maxRev*0.5)) }}</span>
            <span>0</span>
          </div>
          <!-- Bars -->
          <div class="bars">
            <div v-for="bar in chartData" :key="bar.label"
              class="bar-col"
              @mouseenter="e => showTip(e, bar)"
              @mouseleave="hideTip"
              @click="e => { showTip(e, bar); setTimeout(hideTip, 2000) }">
              <div class="bar-track">
                <!-- Ca count label ở trên bar -->
                <div v-if="bar.count" class="bar-top-cnt">{{ bar.count }} ca</div>
                <div class="bar-fill-wrap">
                  <div class="bar-fill"
                    :class="bar.revenue > 0 ? 'bar-has-rev' : 'bar-no-rev'"
                    :style="{ height: bar.revenue > 0
                      ? Math.max((bar.revenue/maxRev)*120, 6)+'px'
                      : '6px' }">
                  </div>
                </div>
              </div>
              <div class="bar-lbl">{{ bar.shortLabel }}</div>
            </div>
          </div>
        </div>

        <!-- Legend -->
        <div class="legend">
          <span class="leg-dot leg-green"></span><span class="leg-txt">Có doanh thu</span>
          <span class="leg-dot leg-gray"></span><span class="leg-txt">Chưa nhập giá</span>
        </div>
      </div>

      <!-- Top ca có doanh thu -->
      <div v-if="topCa.length" class="top-card">
        <div class="top-head">🏆 Ca doanh thu cao nhất</div>
        <div class="top-list">
          <div v-for="(c,i) in topCa" :key="c.ticketId" class="top-row">
            <div :class="['top-rank','r'+(i+1)]">{{ i+1 }}</div>
            <div class="top-info">
              <div class="top-tid">{{ c.ticketId }}</div>
              <div class="top-name">{{ c.name }} · {{ c.doneDate }}</div>
              <div class="top-model">{{ c.model }}</div>
              <div v-if="c.lkItems?.length" class="top-chips">
                <span v-for="lk in c.lkItems" :key="lk.name" class="chip">{{ lk.name }}</span>
              </div>
            </div>
            <div class="top-price">{{ fmtFull(c.price) }}</div>
          </div>
        </div>
      </div>

      <!-- Thông báo nếu chưa nhập giá -->
      <div v-else-if="totalCount > 0" class="hint-box">
        💡 Có {{ totalCount }} ca hoàn thành nhưng chưa nhập giá tiền. Mở modal chi tiết ca → bấm <b>+ Linh kiện / Giá</b> để thêm.
      </div>

    </template>

    <!-- Tooltip -->
    <Teleport to="body">
      <div v-if="tooltip" class="tip"
        :style="{ top: tooltip.y - 10 + 'px', left: Math.min(tooltip.x + 14, (typeof window!=='undefined'?window.innerWidth:800) - 210) + 'px' }">
        <div class="tip-date">📅 {{ tooltip.bar.label }}</div>
        <div class="tip-rev" :class="tooltip.bar.revenue > 0 ? 'has-rev' : 'no-rev'">
          {{ tooltip.bar.revenue > 0 ? fmtFull(tooltip.bar.revenue) : 'Chưa nhập giá' }}
        </div>
        <div class="tip-cnt">{{ tooltip.bar.count }} ca hoàn thành</div>
        <div v-if="tooltip.bar.items?.length" class="tip-items">
          <div v-for="c in tooltip.bar.items.slice(0,3)" :key="c.ticketId" class="tip-item">
            {{ c.ticketId.slice(-6) }} · {{ c.price ? fmtFull(c.price) : '—' }}
          </div>
          <div v-if="tooltip.bar.items.length > 3" class="tip-more">+{{ tooltip.bar.items.length-3 }} ca khác</div>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap');

.rc-page { min-height:100vh; background:#f4f6f9; padding:1.25rem 1rem 3rem; font-family:'DM Sans',system-ui,sans-serif; max-width:860px; margin:0 auto; }

/* Header */
.rc-head { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.75rem; margin-bottom:1rem; }
.rc-title { font-size:1.6rem; font-weight:800; color:#0f172a; margin:0; letter-spacing:-0.03em; }
.rc-sub { font-size:0.78rem; color:#94a3b8; margin:2px 0 0; }
.rc-controls { display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap; }
.seg { display:flex; background:#e2e8f0; border-radius:8px; padding:3px; }
.seg-btn { padding:0.28rem 0.85rem; border:none; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer; background:transparent; color:#64748b; }
.seg-on  { background:#fff; color:#0f172a; box-shadow:0 1px 3px rgba(0,0,0,.1); }
.rc-sel  { padding:0.28rem 0.55rem; border:1.5px solid #e2e8f0; border-radius:8px; font-size:0.8rem; background:#fff; color:#0f172a; font-weight:600; }

/* Loading */
.rc-loading { display:flex; justify-content:center; padding:4rem; }
.spin { width:30px; height:30px; border:3px solid #e2e8f0; border-top-color:#22c55e; border-radius:50%; animation:spin .7s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }

/* Pills */
.pill-row { display:flex; flex-wrap:wrap; gap:0.4rem; margin-bottom:0.85rem; }
.pill { padding:0.25rem 0.7rem; border-radius:20px; font-size:0.76rem; }
.pill-b { background:#dbeafe; color:#1d4ed8; }
.pill-y { background:#fef3c7; color:#92400e; }
.pill-g { background:#d1fae5; color:#065f46; }
.pill-r { background:#fee2e2; color:#b91c1c; }

/* KPI */
.kpi-row { display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-bottom:0.85rem; }
.kpi-pair { display:flex; flex-direction:column; gap:0.6rem; }
.kpi { background:#fff; border-radius:14px; padding:1rem 1.1rem; box-shadow:0 1px 3px rgba(0,0,0,.06); }
.kpi-green { border-left:4px solid #22c55e; }
.kpi-blue  { border-left:4px solid #3b82f6; }
.kpi-teal  { border-left:4px solid #14b8a6; }
.kpi-icon  { font-size:1.2rem; margin-bottom:0.3rem; }
.kpi-val   { font-size:1.2rem; font-weight:800; color:#0f172a; letter-spacing:-0.02em; line-height:1.2; }
.kpi-lbl   { font-size:0.7rem; font-weight:600; color:#64748b; margin-top:0.15rem; }

/* Chart card */
.chart-card { background:#fff; border-radius:16px; padding:1.1rem 1.1rem 0.75rem; box-shadow:0 1px 3px rgba(0,0,0,.06); margin-bottom:0.75rem; }
.chart-title-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:0.85rem; }
.chart-label { font-size:0.82rem; font-weight:700; color:#374151; }
.no-rev-tag { font-size:0.7rem; background:#fef3c7; color:#92400e; padding:0.2rem 0.6rem; border-radius:20px; font-weight:600; }
.chart-empty { text-align:center; color:#94a3b8; padding:2rem; font-size:0.88rem; }

.chart-area { display:flex; gap:6px; align-items:flex-end; }
.y-labels { display:flex; flex-direction:column; justify-content:space-between; width:36px; text-align:right; font-size:0.62rem; color:#94a3b8; height:160px; padding-bottom:0; flex-shrink:0; }

.bars { flex:1; display:flex; align-items:flex-end; gap:4px; overflow-x:auto; padding-bottom:4px; scrollbar-width:none; height:160px; }
.bars::-webkit-scrollbar { display:none; }

.bar-col { display:flex; flex-direction:column; align-items:center; min-width:32px; flex:1; max-width:56px; height:100%; justify-content:flex-end; cursor:pointer; position:relative; }
.bar-col:hover .bar-fill { opacity:.85; }

.bar-track { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; flex:1; width:100%; }
.bar-top-cnt { font-size:0.58rem; color:#64748b; margin-bottom:2px; white-space:nowrap; }
.bar-fill-wrap { width:100%; display:flex; align-items:flex-end; justify-content:center; }
.bar-fill { width:80%; border-radius:5px 5px 0 0; transition:height .4s cubic-bezier(.4,0,.2,1); }
.bar-has-rev { background:linear-gradient(180deg,#4ade80 0%,#16a34a 100%); }
.bar-no-rev  { background:#e2e8f0; border-radius:3px; }
.bar-lbl { font-size:0.62rem; color:#64748b; margin-top:4px; white-space:nowrap; }

/* Legend */
.legend { display:flex; align-items:center; gap:0.5rem; margin-top:0.75rem; padding-top:0.6rem; border-top:1px solid #f1f5f9; }
.leg-dot { width:10px; height:10px; border-radius:3px; display:inline-block; }
.leg-green { background:linear-gradient(135deg,#4ade80,#16a34a); }
.leg-gray  { background:#e2e8f0; }
.leg-txt   { font-size:0.7rem; color:#94a3b8; margin-right:0.6rem; }

/* Top ca */
.top-card { background:#fff; border-radius:16px; padding:1.1rem; box-shadow:0 1px 3px rgba(0,0,0,.06); }
.top-head { font-weight:700; font-size:0.88rem; color:#0f172a; margin-bottom:0.75rem; }
.top-list { display:flex; flex-direction:column; }
.top-row  { display:flex; align-items:flex-start; gap:0.65rem; padding:0.65rem 0; border-bottom:1px solid #f8fafc; }
.top-row:last-child { border-bottom:none; }
.top-rank { width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.75rem; flex-shrink:0; margin-top:2px; }
.r1 { background:#fef3c7; color:#92400e; }
.r2 { background:#f1f5f9; color:#475569; }
.r3 { background:#fef9c3; color:#713f12; }
.r4,.r5 { background:#f8fafc; color:#94a3b8; }
.top-info  { flex:1; min-width:0; }
.top-tid   { font-weight:700; font-size:0.78rem; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.top-name  { font-size:0.72rem; color:#64748b; }
.top-model { font-size:0.68rem; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.top-chips { display:flex; flex-wrap:wrap; gap:0.2rem; margin-top:0.25rem; }
.chip      { background:#f0fdf4; color:#166534; font-size:0.65rem; padding:0.08rem 0.4rem; border-radius:8px; }
.top-price { font-size:0.88rem; font-weight:800; color:#16a34a; white-space:nowrap; align-self:center; }

/* Hint box */
.hint-box { background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:1rem 1.1rem; font-size:0.82rem; color:#78350f; line-height:1.5; }

/* Tooltip */
.tip { position:fixed; background:#0f172a; color:#fff; border-radius:10px; padding:0.55rem 0.8rem; font-size:0.76rem; z-index:9999; pointer-events:none; max-width:200px; box-shadow:0 4px 20px rgba(0,0,0,.3); }
.tip-date { font-weight:700; margin-bottom:3px; color:#94a3b8; font-size:0.7rem; }
.tip-rev  { font-weight:800; font-size:0.95rem; margin-bottom:2px; }
.has-rev  { color:#4ade80; }
.no-rev   { color:#64748b; font-style:italic; font-size:0.8rem; }
.tip-cnt  { color:#94a3b8; font-size:0.7rem; }
.tip-items { margin-top:5px; border-top:1px solid #1e293b; padding-top:4px; }
.tip-item  { font-size:0.68rem; color:#cbd5e1; }
.tip-more  { font-size:0.65rem; color:#475569; }

/* Mobile */
@media (max-width:480px) {
  .rc-page { padding:0.85rem 0.75rem 2rem; }
  .rc-title { font-size:1.25rem; }
  .kpi-val  { font-size:1rem; }
  .kpi { padding:0.75rem 0.85rem; }
  .bars { height:130px; }
  .y-labels { height:130px; }
  .top-price { font-size:0.8rem; }
  .rc-head { gap:0.5rem; }
}
</style>