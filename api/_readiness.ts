/** 준비도(0~100) — 검토 보고서 공식. 60일 개인 기준선 z-점수, HRV는 ln(SDNN) 7일 평균에 최대 가중, 질병 패턴은 상한(cap). */
import { groupNights, dailySeries, dur, type Tabs } from './_health.js'

type Comp = { key: string; label: string; w: number; z: number; sub: number; text: string; bad: boolean }
const mean = (xs: number[]) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((v) => (v - m) ** 2))) }
const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const sub = (z: number) => 100 * clip(0.5 + z / 4, 0, 1)
const shift = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
const MIN_BASE = 14

/** series에서 [from, to] 구간의 값들(날짜순) */
const window = (s: Map<string, number>, from: string, to: string) => [...s.entries()].filter(([d]) => d >= from && d <= to).sort().map(([, v]) => v)
/** 오늘 또는 어제 값(어느 날짜인지 함께) */
const latest = (s: Map<string, number>, today: string) => s.has(today) ? { d: today, v: s.get(today)! } : s.has(shift(today, -1)) ? { d: shift(today, -1), v: s.get(shift(today, -1))! } : null

export function readiness(tabs: Tabs, today: string) {
  const b0 = shift(today, -60), b1 = shift(today, -1)   // 기준선: 오늘 제외 60일
  const comps: Comp[] = []
  const zOf = (v: number, base: number[]) => base.length >= MIN_BASE && sd(base) > 0 ? clip((v - mean(base)) / sd(base), -3, 3) : NaN

  // HRV: ln(SDNN)
  const hrv = dailySeries(tabs.hrv); const lnHrv = new Map([...hrv].map(([d, v]) => [d, Math.log(v)]))
  const base = window(lnHrv, b0, b1)
  const last7 = window(lnHrv, shift(today, -6), today)
  if (last7.length >= 3) {
    const z = zOf(mean(last7), base); const m7 = Math.exp(mean(last7)), m60 = Math.exp(mean(base))
    if (!isNaN(z)) comps.push({ key: 'hrv7', label: 'HRV 7일 평균', w: 0.30, z, sub: sub(z), bad: z < -1, text: `HRV 7일 평균 ${m7.toFixed(0)}ms (평소 ${m60.toFixed(0)}, ${((m7 / m60 - 1) * 100).toFixed(0)}%)` })
  }
  const h1 = latest(lnHrv, today)
  if (h1) { const z = zOf(h1.v, base); if (!isNaN(z)) comps.push({ key: 'hrv1', label: 'HRV 어젯밤', w: 0.10, z, sub: sub(z), bad: z < -1, text: `HRV ${Math.exp(h1.v).toFixed(0)}ms` }) }

  // 안정시 심박 (높으면 나쁨)
  const rhr = dailySeries(tabs.resting_hr); const r1 = latest(rhr, today)
  if (r1) { const bs = window(rhr, b0, b1); const z = zOf(r1.v, bs); if (!isNaN(z)) comps.push({ key: 'rhr', label: '안정심박', w: 0.15, z: -z, sub: sub(-z), bad: z > 1, text: `안정심박 ${r1.v.toFixed(0)} (평소 ${mean(bs).toFixed(0)}, ${r1.v - mean(bs) >= 0 ? '+' : ''}${(r1.v - mean(bs)).toFixed(0)})` }) }

  // 수면: 어젯밤 총수면 vs 60일 평균 (평균 이상이면 만점), 부채 = 7일 평균 vs 60일 평균
  const nights = groupNights(tabs.sleep ?? [])
  const tot = new Map(nights.map((n) => [n.key, n.core + n.rem + n.deep]))
  const s1 = latest(tot, today)
  const sBase = window(tot, b0, b1)
  if (s1 && sBase.length >= MIN_BASE) {
    const z = clip((s1.v - mean(sBase)) / (sd(sBase) || 1), -3, 3)
    comps.push({ key: 'sleep', label: '어젯밤 수면', w: 0.20, z, sub: z >= 0 ? 100 : sub(z), bad: z < -1, text: `수면 ${dur(s1.v)} (평소 ${dur(mean(sBase))}, ${s1.v - mean(sBase) >= 0 ? '+' : '-'}${dur(Math.abs(s1.v - mean(sBase)))})${s1.d !== today ? ' ※ 어젯밤 기록 아직 없음, 전날 기준' : ''}` })
    const w7 = window(tot, shift(today, -6), today)
    if (w7.length >= 3) { const z7 = clip((mean(w7) - mean(sBase)) / (sd(sBase) || 1), -3, 3); comps.push({ key: 'debt', label: '수면 부채', w: 0.05, z: z7, sub: sub(z7), bad: z7 < -1, text: `7일 평균 수면 ${dur(mean(w7))}` }) }
  }

  // 손목 온도(편차 °C, 높으면 나쁨) · 호흡수(높으면 나쁨)
  const temp = dailySeries(tabs.wrist_temp); const t1 = latest(temp, today)
  let tz = NaN
  if (t1) { const bs = window(temp, b0, b1); const z = zOf(t1.v, bs); if (!isNaN(z)) { tz = z; comps.push({ key: 'temp', label: '손목온도', w: 0.10, z: -z, sub: sub(-z), bad: z > 1, text: `손목온도 ${t1.v - mean(bs) >= 0 ? '+' : ''}${(t1.v - mean(bs)).toFixed(1)}°` }) } }
  const rr = dailySeries(tabs.respiratory_rate); const rr1 = latest(rr, today)
  let rz = NaN
  if (rr1) { const bs = window(rr, b0, b1); const z = zOf(rr1.v, bs); if (!isNaN(z)) { rz = z; comps.push({ key: 'rr', label: '호흡수', w: 0.05, z: -z, sub: sub(-z), bad: z > 1, text: `호흡 ${rr1.v.toFixed(1)}/분 (평소 ${mean(bs).toFixed(1)})` }) } }

  // 전날 부하: 활동 kcal vs 28일, +1 SD 넘으면 감점 (sRPE가 쌓이면 그걸로 교체)
  const kcal = dailySeries(tabs.active_kcal); const y = shift(today, -1)
  if (kcal.has(y)) { const bs = window(kcal, shift(today, -29), shift(today, -2)); const z = zOf(kcal.get(y)!, bs); if (!isNaN(z)) { const pen = Math.max(0, z - 1); comps.push({ key: 'load', label: '전날 부하', w: 0.05, z: -pen, sub: 100 * clip(1 - pen / 2, 0, 1), bad: z > 1.5, text: `전날 활동 ${kcal.get(y)!.toFixed(0)}kcal (28일 평균 ${mean(bs).toFixed(0)})` }) } }

  if (!comps.length || !comps.some((c) => c.key === 'hrv7' || c.key === 'sleep')) return { score: NaN, band: '기준선 축적 중', reasons: ['60일 중 14일 이상 데이터가 쌓이면 점수를 냅니다'], comps }

  // 가중 평균(없는 항목은 가중치 재분배)
  const W = comps.reduce((s, c) => s + c.w, 0)
  let score = comps.reduce((s, c) => s + c.w * c.sub, 0) / W
  const caps: string[] = []
  const rhrz = -(comps.find((c) => c.key === 'rhr')?.z ?? 0)
  if (tz >= 2 && (rhrz >= 1 || rz >= 1)) { score = Math.min(score, 40); caps.push('질병 가능성(손목온도↑ + 심박/호흡↑)') }
  const badN = comps.filter((c) => ['hrv7', 'rhr', 'temp', 'rr'].includes(c.key) && c.z <= -1.5).length
  if (badN >= 2) { score = Math.min(score, 55); caps.push('회복 지표 둘 이상 이탈') }
  score = Math.round(score)
  const band = score >= 75 ? '강하게 해도 됨' : score >= 50 ? '계획대로' : score >= 30 ? '가볍게' : '휴식'
  const neg = comps.filter((c) => c.z < 0).sort((a, b) => a.z - b.z).slice(0, 3).map((c) => c.text)
  const pos = comps.filter((c) => c.z > 0.5).sort((a, b) => b.z - a.z).slice(0, 1).map((c) => c.text + ' ✓')
  return { score, band, reasons: [...caps.map((c) => '⚠ ' + c), ...neg, ...pos], comps }
}

export function formatReadiness(r: ReturnType<typeof readiness>, today: string): string {
  if (isNaN(r.score)) return `준비도 — ${r.band}\n${r.reasons.join('\n')}`
  return `준비도 ${r.score} · ${r.band} (${today})\n` + r.reasons.map((x) => '- ' + x).join('\n') +
    `\n\n[구성] ` + r.comps.map((c) => `${c.label} ${Math.round(c.sub)}`).join(' · ')
}
