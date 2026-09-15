/** 준비도(0~100) - 검토 보고서 공식. 60일 개인 기준선 z-점수, HRV는 ln(SDNN) 7일 평균에 최대 가중, 질병 패턴은 상한(cap). */
import { groupNights, dailySeries, dur, type Tabs } from './_health.js'

export type Tone = 'good' | 'neutral' | 'warn' | 'bad'
export type Comp = { key: string; label: string; w: number; z: number; sub: number; text: string; bad: boolean; friendly: string }
const mean = (xs: number[]) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((v) => (v - m) ** 2))) }
const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const sub = (z: number) => 100 * clip(0.5 + z / 4, 0, 1)
/**
 * 한쪽으로만 채점한다. 손목온도와 호흡수는 **높으면 나쁘고, 낮다고 좋은 게 아니다**.
 * 양방향으로 두면 기준선보다 낮기만 해도 만점을 받는다. 실제로 손목온도가 평소보다
 * 0.6° 낮은 날 100점이 붙어 준비도가 5점 부풀었다. 정상 범위는 만점이 아니라 중립이다.
 */
const subPenaltyOnly = (z: number) => sub(Math.min(0, z))
const shift = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
const MIN_BASE = 14
/** 401 → "6시간 41분", 62 → "1시간 02분", 12 → "12분" */
const hm = (min: number) => { const m = Math.round(Math.abs(min)); return m >= 60 ? `${Math.floor(m / 60)}시간 ${String(m % 60).padStart(2, '0')}분` : `${m}분` }
const dir = (z: number, good = '평소보다 좋음', bad = '평소보다 낮음', mid = '평소 수준') => z > 0.5 ? good : z < -0.5 ? bad : mid

/**
 * n일 평균을 **하루치 표준편차**로 재면 안 된다. 평균은 노이즈가 상쇄돼 하루치만큼 흔들리지
 * 않으므로 z가 늘 0 근처(=50점)로 눌린다. 실측으로 lnHRV의 하루치 SD는 7일 평균 SD의 3.5배였다.
 * 가중치가 가장 큰 HRV 7일 평균(0.30)과 수면 부채(0.05)가 이 때문에 구조적으로 50~65에 갇혀
 * 있었고, HRV가 평소보다 11% 높은 좋은 주에도 준비도가 74에서 움직이지 않았다.
 * √n 을 가정하는 대신 기준선 구간에서 같은 길이의 연속 평균을 실제로 만들어 그 SD로 잰다.
 * (자기상관을 데이터가 알아서 반영하고, 표본이 모자라면 NaN 이라 항목이 조용히 빠진다.)
 */
const zOfMean = (cur: number, base: number[], n: number) => {
  if (base.length < n + MIN_BASE || !(sd(base) > 0)) return NaN
  const rolls = Array.from({ length: base.length - n + 1 }, (_, i) => mean(base.slice(i, i + n)))
  // 바닥은 독립일 때의 이론값 sd/√n. 거의 일정한 구간에서 실측 SD가 0 가까이 내려가면
  // 사소한 차이가 z 3 으로 튀어 만점·빵점이 붙는다. 실측이 더 클 때만 실측을 쓴다.
  const den = Math.max(sd(rolls), sd(base) / Math.sqrt(n))
  return clip((cur - mean(rolls)) / den, -3, 3)
}

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
    const z = zOfMean(mean(last7), base, last7.length); const m7 = Math.exp(mean(last7)), m60 = Math.exp(mean(base))
    if (!isNaN(z)) comps.push({ key: 'hrv7', label: 'HRV 7일 평균', w: 0.30, z, sub: sub(z), bad: z < -1, text: `HRV 7일 평균 ${m7.toFixed(0)}ms (평소 ${m60.toFixed(0)}, ${((m7 / m60 - 1) * 100).toFixed(0)}%)`, friendly: `회복 신호(심박 변이) ${m7.toFixed(0)}ms, ${dir(z, '평소보다 좋음', '평소보다 낮음, 피로가 쌓이는 중')}` })
  }
  const h1 = latest(lnHrv, today)
  if (h1) { const z = zOf(h1.v, base); if (!isNaN(z)) comps.push({ key: 'hrv1', label: 'HRV 어젯밤', w: 0.10, z, sub: sub(z), bad: z < -1, text: `HRV ${Math.exp(h1.v).toFixed(0)}ms`, friendly: `어젯밤 회복 신호 ${Math.exp(h1.v).toFixed(0)}ms, ${dir(z)}` }) }

  // 안정시 심박 (높으면 나쁨)
  const rhr = dailySeries(tabs.resting_hr); const r1 = latest(rhr, today)
  if (r1) { const bs = window(rhr, b0, b1); const z = zOf(r1.v, bs); if (!isNaN(z)) comps.push({ key: 'rhr', label: '안정심박', w: 0.15, z: -z, sub: sub(-z), bad: z > 1, text: `안정심박 ${r1.v.toFixed(0)} (평소 ${mean(bs).toFixed(0)}, ${r1.v - mean(bs) >= 0 ? '+' : ''}${(r1.v - mean(bs)).toFixed(0)})`, friendly: `안정시 심박 ${r1.v.toFixed(0)}, 평소보다 ${Math.abs(r1.v - mean(bs)).toFixed(0)} ${r1.v >= mean(bs) ? '높음, 몸이 아직 회복 중' : '낮음, 좋은 신호'}` }) }

  // 수면: 어젯밤 총수면 vs 60일 평균 (평균 이상이면 만점), 부채 = 7일 평균 vs 60일 평균
  const nights = groupNights(tabs.sleep ?? [])
  const tot = new Map(nights.map((n) => [n.key, n.core + n.rem + n.deep]))
  const s1 = latest(tot, today)
  const sBase = window(tot, b0, b1)
  if (s1 && sBase.length >= MIN_BASE) {
    const z = clip((s1.v - mean(sBase)) / (sd(sBase) || 1), -3, 3)
    comps.push({ key: 'sleep', label: '어젯밤 수면', w: 0.20, z, sub: z >= 0 ? 100 : sub(z), bad: z < -1, text: `수면 ${dur(s1.v)} (평소 ${dur(mean(sBase))}, ${s1.v - mean(sBase) >= 0 ? '+' : '-'}${dur(Math.abs(s1.v - mean(sBase)))})${s1.d !== today ? ' ※ 어젯밤 기록 아직 없음, 전날 기준' : ''}`, friendly: `잠 ${hm(s1.v)}, 평소보다 ${hm(s1.v - mean(sBase))} ${s1.v >= mean(sBase) ? '더 잠' : '부족'}${s1.d !== today ? ' (어젯밤 기록 아직 없어 전날 기준)' : ''}` })
    const w7 = window(tot, shift(today, -6), today)
    const z7 = w7.length >= 3 ? zOfMean(mean(w7), sBase, w7.length) : NaN
    if (!isNaN(z7)) { comps.push({ key: 'debt', label: '수면 부채', w: 0.05, z: z7, sub: sub(z7), bad: z7 < -1, text: `7일 평균 수면 ${dur(mean(w7))}`, friendly: `이번 주 평균 수면 ${hm(mean(w7))}, ${z7 < -0.5 ? '평소보다 부족한 편' : '평소 수준'}` }) }
  }

  // 손목 온도(편차 °C, 높으면 나쁨) · 호흡수(높으면 나쁨)
  const temp = dailySeries(tabs.wrist_temp); const t1 = latest(temp, today)
  let tz = NaN
  if (t1) { const bs = window(temp, b0, b1); const z = zOf(t1.v, bs); if (!isNaN(z)) { tz = z; comps.push({ key: 'temp', label: '손목온도', w: 0.10, z: -z, sub: subPenaltyOnly(-z), bad: z > 1, text: `손목온도 ${t1.v - mean(bs) >= 0 ? '+' : ''}${(t1.v - mean(bs)).toFixed(1)}°`, friendly: `손목 온도 평소보다 ${t1.v - mean(bs) >= 0 ? '+' : ''}${(t1.v - mean(bs)).toFixed(1)}°${z >= 1 ? ', 무리했거나 아플 수 있어요' : ', 평소 범위'}` }) } }
  const rr = dailySeries(tabs.respiratory_rate); const rr1 = latest(rr, today)
  let rz = NaN
  if (rr1) { const bs = window(rr, b0, b1); const z = zOf(rr1.v, bs); if (!isNaN(z)) { rz = z; comps.push({ key: 'rr', label: '호흡수', w: 0.05, z: -z, sub: subPenaltyOnly(-z), bad: z > 1, text: `호흡 ${rr1.v.toFixed(1)}/분 (평소 ${mean(bs).toFixed(1)})`, friendly: `호흡수 ${rr1.v.toFixed(1)}/분, ${z >= 1 ? '평소보다 높음, 컨디션 저하 신호' : '평소 범위'}` }) } }

  // 전날 부하: 활동 kcal vs 28일, +1 SD 넘으면 감점 (sRPE가 쌓이면 그걸로 교체)
  const kcal = dailySeries(tabs.active_kcal); const y = shift(today, -1)
  if (kcal.has(y)) { const bs = window(kcal, shift(today, -29), shift(today, -2)); const z = zOf(kcal.get(y)!, bs); if (!isNaN(z)) { const pen = Math.max(0, z - 1); comps.push({ key: 'load', label: '전날 부하', w: 0.05, z: -pen, sub: 100 * clip(1 - pen / 2, 0, 1), bad: z > 1.5, text: `전날 활동 ${kcal.get(y)!.toFixed(0)}kcal (28일 평균 ${mean(bs).toFixed(0)})`, friendly: `어제 활동 ${kcal.get(y)!.toFixed(0)}kcal, ${pen > 0 ? '평소보다 많았음, 오늘은 회복 쪽으로' : '평소 수준'}` }) } }

  if (!comps.length || !comps.some((c) => c.key === 'hrv7' || c.key === 'sleep')) return { score: NaN, band: '기준선 축적 중', reasons: ['60일 중 14일 이상 데이터가 쌓이면 점수를 냅니다'], comps, caps: [] as string[], illness: false }

  // 가중 평균(없는 항목은 가중치 재분배)
  const W = comps.reduce((s, c) => s + c.w, 0)
  let score = comps.reduce((s, c) => s + c.w * c.sub, 0) / W
  const caps: string[] = []
  const rhrz = -(comps.find((c) => c.key === 'rhr')?.z ?? 0)
  if (tz >= 2 && (rhrz >= 1 || rz >= 1)) { score = Math.min(score, 40); caps.push('질병 가능성(손목온도↑ + 심박/호흡↑)') }
  // 손목온도가 없는 날에도 질병 패턴을 놓치지 않는다.
  // 워치가 손목온도를 재는 밤이 관측 120일 중 39일뿐이었다. 나머지 날에는 위 판정이
  // 성립할 수 없어서, 아파도 '휴식'이 구조적으로 나올 수 없었다.
  // 대신 문턱을 높인다 - 안정심박↑·호흡수↑·HRV↓ 중 둘 이상이 크게(|z|≥1.5) 이탈해야 한다.
  // 완전 휴식 권고는 한 번 틀리면 다음부터 안 믿게 되므로 보수적으로 잡는다.
  // NaN 비교는 항상 false라 값이 없는 지표는 자동으로 빠진다.
  const hrv7z = comps.find((c) => c.key === 'hrv7')?.z ?? NaN
  if (isNaN(tz)) {
    const flags = [rhrz >= 1.5, rz >= 1.5, hrv7z <= -1.5].filter(Boolean).length
    if (flags >= 2) { score = Math.min(score, 40); caps.push('질병 가능성(회복 지표 둘 이상 크게 이탈)') }
  }
  const badN = comps.filter((c) => ['hrv7', 'rhr', 'temp', 'rr'].includes(c.key) && c.z <= -1.5).length
  if (badN >= 2) { score = Math.min(score, 55); caps.push('회복 지표 둘 이상 이탈') }
  score = Math.round(score)
  const illness = caps.some((c) => c.startsWith('질병 가능성'))
  // 낮은 점수만으로 계획을 건너뛰지 않는다. 완전 휴식은 질병 패턴일 때만 권한다.
  const band = illness ? '휴식' : score >= 75 ? '강하게 해도 됨' : score >= 50 ? '계획대로' : '가볍게'
  const neg = comps.filter((c) => c.z < 0).sort((a, b) => a.z - b.z).slice(0, 3).map((c) => c.text)
  const pos = comps.filter((c) => c.z > 0.5).sort((a, b) => b.z - a.z).slice(0, 1).map((c) => c.text + ' ✓')
  return { score, band, reasons: [...caps.map((c) => '⚠ ' + c), ...neg, ...pos], comps, caps, illness }
}

export const componentTone = (c: Comp): Tone => c.bad || c.z <= -1.5 ? 'bad' : c.z < -0.5 ? 'warn' : c.z > 0.3 || c.sub >= 90 ? 'good' : 'neutral'

/** 화면용 준비도. 모든 문장과 tone은 계산된 구성 요소에서 만들며 문자열을 역파싱하지 않는다. */
export function structuredReadiness(r: ReturnType<typeof readiness>) {
  const score = isNaN(r.score) ? null : r.score
  const headline = score == null ? '기록이 더 쌓이면 오늘의 준비도를 계산할 수 있어요.'
    : r.band === '강하게 해도 됨' ? '몸이 준비됐어요. 계획한 운동을 해도 좋은 날이에요.'
      : r.band === '계획대로' ? '무리 없이 계획대로 하면 되는 날이에요.'
        : r.band === '가볍게' ? '건너뛰기보다 강도를 낮춰 움직이는 날이에요.'
          : '질병 신호를 살피며 회복을 우선할 날이에요.'
  const preferred = ['sleep', 'hrv7', 'rhr', 'temp', 'rr', 'load', 'debt', 'hrv1']
  // HRV 줄이 두 개 나오면 중복이라 7일 평균만 남긴다(단일 밤 값은 노이즈가 커서 판단 근거로 약하다)
  const pool = r.comps.some((c) => c.key === 'hrv7') ? r.comps.filter((c) => c.key !== 'hrv1') : r.comps
  const concern = (c: Comp) => c.bad ? 100 : Math.max(0, -c.z) * 10
  const worrying = pool.some((c) => concern(c) > 5)   // z < -0.5 인 항목이 하나라도 있으면 걱정 순서로
  const picked = [...pool].sort((a, b) => (worrying ? concern(b) - concern(a) : 0)
    || preferred.indexOf(a.key) - preferred.indexOf(b.key)).slice(0, 3)
  const lines = picked.length
    ? picked.map((c) => ({ text: c.friendly || c.text, tone: componentTone(c) }))
    : [{ text: r.reasons[0] ?? '기록을 기다리고 있어요.', tone: 'neutral' as const }]
  return {
    score, band: r.band, headline, lines,
    components: r.comps.map((c) => ({ key: c.key, label: c.label, score: Math.round(c.sub), weight: c.w, z: Math.round(c.z * 100) / 100, text: c.text, tone: componentTone(c) })),
  }
}

export function formatReadiness(r: ReturnType<typeof readiness>, today: string, tail = ''): string {
  if (isNaN(r.score)) return `준비도 - ${r.band}\n${r.reasons.join('\n')}` + tail
  return `준비도 ${r.score} · ${r.band} (${today})\n` + r.reasons.map((x) => '- ' + x).join('\n') +
    `\n\n[구성] ` + r.comps.map((c) => `${c.label} ${Math.round(c.sub)}`).join(' · ') + tail
}

/** 알림용 쉬운 말 버전. 숫자 대신 "평소보다 ~" 문장, 눈에 띄는 항목만. */
export function formatFriendly(r: ReturnType<typeof readiness>, tail = ''): string {
  if (isNaN(r.score)) return `준비도 계산 중. ${r.reasons[0]}` + tail
  const v = structuredReadiness(r)
  return [`준비도 ${r.score}. ${v.headline}`, ...r.caps.map((c) => '⚠ ' + c), ...v.lines.map((l) => l.text)].join('\n') + tail
}

