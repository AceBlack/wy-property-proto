/**
 * 智慧物业 V2 · ECharts 5 主题（SCRM 风格版）
 * 配色基调：靛蓝紫 #5B6CFF 主序 + 薄荷青 #2ED9A3 辅序 + 紫罗兰/暖橙扩展
 * 用法：
 *   import * as echarts from 'echarts'
 *   import wyTheme from '@/styles/echarts-theme'
 *   echarts.registerTheme('wy', wyTheme)
 *   const chart = echarts.init(el, 'wy')
 *
 * 约定：
 *   1. 所有图表必须通过 theme 初始化，禁止在页面里硬编码颜色
 *   2. 色序与 tokens.css 的 --chart-c1..c8 保持一致
 *   3. 柱状图统一细柱 + 顶部大圆角，面积图带渐变填充
 *   4. 单位写在 axisName / tooltip 后缀里，不写进 series.name
 */
const palette = [
  '#5B6CFF', '#2ED9A3', '#8A63F2', '#FFB05C',
  '#4DC9FF', '#FF7DA0', '#3EDBC4', '#A0A8C8'
]

/** 纵向渐变：从色值到 12% 透明度，用于柱/面积 */
function vGrad (color, fromOpacity = .32, toOpacity = .04) {
  return {
    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [
      { offset: 0, color: hexA(color, fromOpacity) },
      { offset: 1, color: hexA(color, toOpacity) }
    ]
  }
}

/** hex → rgba */
function hexA (hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// 图表内的数字与西文同样走 DIN（canvas 按字符回退，中文自动落回苹方/雅黑）。
// 与 tokens.css 的 --biz-font-num 保持同一顺序，改字体时两处一起改。
const FONT_NUM = "'DIN Pro','DIN Alternate','Bahnschrift',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"

const wyTheme = {
  color: palette,
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: FONT_NUM,
    fontSize: 12,
    color: '#6A7390'
  },
  title: {
    textStyle: { fontSize: 14, fontWeight: 600, color: '#1F2540' },
    subtextStyle: { fontSize: 12, color: '#8A94B0' },
    itemGap: 6,
    left: 0,
    top: 0
  },
  legend: {
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 16,
    icon: 'roundRect',
    textStyle: { fontSize: 12, color: '#6A7390' },
    top: 0,
    right: 0
  },
  tooltip: {
    backgroundColor: 'rgba(255,255,255,.97)',
    borderColor: '#E3E6F2',
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { fontSize: 12, color: '#1F2540' },
    extraCssText: 'box-shadow: 0 8px 28px rgba(31,37,64,.14); border-radius: 10px;',
    axisPointer: {
      lineStyle: { color: '#C3C9DD', type: 'dashed' },
      crossStyle: { color: '#C3C9DD' },
      shadowStyle: { color: 'rgba(91,108,255,.06)' }
    }
  },
  grid: { left: 8, right: 8, top: 32, bottom: 8, containLabel: true },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: '#E3E6F2', width: 1 } },
    axisTick: { show: false },
    axisLabel: { show: true, fontSize: 12, color: '#8A94B0', margin: 10 },
    splitLine: { show: false },
    splitArea: { show: false }
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: true, fontSize: 12, color: '#8A94B0', margin: 10 },
    splitLine: { show: true, lineStyle: { color: '#EEF0F8', type: 'solid' } },
    splitArea: { show: false }
  },
  logAxis: {
    axisLine: { show: false },
    axisLabel: { fontSize: 12, color: '#8A94B0' },
    splitLine: { show: true, lineStyle: { color: '#EEF0F8' } }
  },
  timeAxis: {
    axisLine: { show: true, lineStyle: { color: '#E3E6F2' } },
    axisTick: { show: false },
    axisLabel: { fontSize: 12, color: '#8A94B0' },
    splitLine: { show: false }
  },
  line: {
    symbolSize: 6,
    symbol: 'emptyCircle',
    smooth: .4,
    lineStyle: { width: 2.5 },
    emphasis: { focus: 'series', lineStyle: { width: 3 } }
  },
  bar: {
    // 细柱 + 顶部大圆角：柱宽由 barMaxWidth 兜底（16px 绝对值），
    // 页面不要再用 barWidth:'46%' 这种百分比 —— 容器一变柱子就变粗，与规范冲突。
    // 横向条形图请在页面里显式写 borderRadius:[0,8,8,0]。
    barMaxWidth: 16,
    itemStyle: { borderRadius: [8, 8, 0, 0], color: '#5B6CFF' },
    emphasis: { focus: 'series' }
  },
  pie: {
    radius: ['52%', '72%'],
    center: ['50%', '54%'],
    itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 8 },
    label: { fontSize: 12, color: '#6A7390', formatter: '{b} {d}%' },
    labelLine: { length: 10, length2: 10, lineStyle: { color: '#C3C9DD' } },
    emphasis: { scale: true, scaleSize: 5 }
  },
  gauge: {
    progress: { show: true, width: 12, roundCap: true },
    axisLine: { lineStyle: { width: 12, color: [[1, '#EEF0F8']] } },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { show: false },
    pointer: { show: false },
    detail: { fontSize: 24, fontWeight: 600, fontFamily: FONT_NUM, color: '#1F2540', offsetCenter: [0, '0%'], formatter: '{value}%' },
    title: { fontSize: 12, color: '#8A94B0', offsetCenter: [0, '32%'] }
  },
  radar: {
    axisName: { fontSize: 12, color: '#6A7390' },
    splitLine: { lineStyle: { color: '#EEF0F8' } },
    splitArea: { areaStyle: { color: ['rgba(91,108,255,.03)', 'rgba(91,108,255,.06)'] } },
    axisLine: { lineStyle: { color: '#EEF0F8' } }
  },
  heatmap: {
    itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 }
  },
  // 空数据：统一由业务层用 el-empty 覆盖，不在图表里画「暂无数据」文字
  aria: { enabled: true, decal: { show: false } }
}

export default wyTheme
export { palette, vGrad, hexA }

/**
 * 热力色阶（空置率 / 收费率等比率型指标）
 * 固定分段，不随当期最大最小值自适应 —— 否则跨月不可比。
 * 值域 0~100，越低越好时用 reverse=true。
 */
export function heatColor (value, reverse = false) {
  const steps = [
    { max: 5, color: '#D5F8EA' },   // 极好
    { max: 10, color: '#96EDCF' },  // 良好
    { max: 15, color: '#FFE2C2' },  // 关注
    { max: 25, color: '#FFCF9B' },  // 预警
    { max: 100, color: '#FFB3B3' }  // 严重
  ]
  const v = reverse ? 100 - value : value
  for (const s of steps) if (v <= s.max) return s.color
  return steps[steps.length - 1].color
}

/** 指标语义色：达标绿 / 未达标红 / 持平灰 */
export function metricColor (value, target, higherIsBetter = true) {
  if (value === target) return '#8A94B0'
  const better = higherIsBetter ? value > target : value < target
  return better ? '#2ED9A3' : '#FF6B6B'
}

/** 告警等级色 */
export const alarmColor = {
  '紧急': '#FF6B6B',
  '重要': '#FF9F40',
  '一般': '#5B6CFF',
  '提示': '#8A94B0'
}
