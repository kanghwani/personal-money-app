/**
 * 유튜브 구독자 이벤트 — 판정·날짜·상태 접기·한 줄 문법(순수 함수) + YouTube API·시트 입출력(맨 아래).
 * 설계: docs/superpowers/specs/2026-09-21-youtube-events-design.md
 *
 * 저장은 건강 탭 저장 경로(action=health&type=events)를 그대로 쓴다. 수정 없이 추가만 하고,
 * 현재 상태 = videoId 별 마지막 행. 언제 지원·확인했는지가 공짜로 남는다.
 */
import type { HealthRow } from './_health.js'
import { gasGet, gasPost } from './_gas.js'
import { logStamp } from './_log.js'

export type Snippet = { videoId: string; title: string; description: string; publishedAt: string; channelTitle: string; channelId?: string; comments?: number; live?: boolean }
export type Status = 'new' | 'reminded' | 'applied' | 'won' | 'lost' | 'skipped'
export type Event = {
  id: string; channel: string; title: string
  deadline: string; announce: string; deadlineGuessed: boolean; announceGuessed: boolean
  excerpt: string; status: Status; note: string; found: string; updated: string
  comments?: number; subs?: number    // 스캔 시점 댓글 수·채널 구독자 수 (경쟁률). 옛 행엔 없다
  channelId?: string                  // 스캔 중에만 쓴다(구독자 수 조회). 시트엔 안 남긴다
  fromSearch?: boolean                // 검색으로 온 것 — 구독자 하한을 건다. 시트엔 안 남긴다
}
export type Channel = { id: string; name: string; handle: string }

const STATUSES: Status[] = ['new', 'reminded', 'applied', 'won', 'lost', 'skipped']
const ACTIVE: Status[] = ['new', 'reminded', 'applied']
// 오탐보다 미탐이 싸다. 좁게 시작하고 시트에 쌓인 실제 사례로 넓힌다.
// "드립니다·드려요"는 "부탁드려요·설명드립니다"에 걸려 뺐다.
const EVENT_RE = /이벤트|증정|추첨|경품|나눔|선물/
const APPLY_RE = /구독|댓글/
export const isEvent = (title: string, desc: string) => EVENT_RE.test(title + '\n' + desc) && APPLY_RE.test(title + '\n' + desc)
/**
 * 검색 결과는 감시 채널보다 훨씬 지저분하다(첫 실검색 95건 중 쓸 만한 건 ~18건). 그래서 검색으로 온 것만 더 거른다:
 * 경품이 실제로 언급되고, 라이브가 아니고, 결과 발표 영상이 아니고, 구독자 1천 이상(첫 실검색에서 1천 미만 36건은 전부 잡음).
 */
const PRIZE_RE = /증정|경품|선물|기프티콘|상품권|나눔|추첨|선정|뽑/
export const SEARCH_MIN_SUBS = 1000
export const isSearchWorthy = (s: Snippet) => !s.live && !/결과|당첨자/.test(s.title) && PRIZE_RE.test(s.title + '\n' + s.description)

// ── 날짜 ────────────────────────────────────────────────────
const DAY = 86400_000
const pad = (n: number) => String(n).padStart(2, '0')
export const kstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)
export const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
/** "MM-DD" → 올해, 오늘보다 앞서면 내년 */
export function mmddToYmd(mmdd: string, today: string): string {
  const y = +today.slice(0, 4)
  const d = `${y}-${mmdd}`
  return d < today ? `${y + 1}-${mmdd}` : d
}

type Cand = { ymd: string; at: number; end: number }
/** 설명에서 날짜 후보를 위치와 함께. 게시일 이상 · 게시일+90일 이하만. */
function candidates(desc: string, published: string): Cand[] {
  const year = +published.slice(0, 4)
  const out: Cand[] = []
  const push = (m: RegExpMatchArray, y: number | null, mo: number, d: number) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return
    let ymd = `${y ?? year}-${pad(mo)}-${pad(d)}`
    if (y === null && ymd < published) ymd = `${year + 1}-${pad(mo)}-${pad(d)}`
    if (ymd < published || ymd > addDays(published, 90)) return
    out.push({ ymd, at: m.index ?? 0, end: (m.index ?? 0) + m[0].length })
  }
  for (const m of desc.matchAll(/(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})/g)) push(m, +m[1], +m[2], +m[3])
  for (const m of desc.matchAll(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) push(m, null, +m[1], +m[2])
  // 9/30, 9.30 — 전화번호(하이픈)·시각(콜론)·가격(9.900)은 안 걸린다
  for (const m of desc.matchAll(/(?<![\d.])(\d{1,2})\s?[/.]\s?(\d{1,2})(?![\d.])/g)) push(m, null, +m[1], +m[2])
  out.sort((a, b) => a.at - b.at)
  // "9월 18일부터 30일까지" — 월 없는 "30일"은 앞(40자 안)에 나온 날짜의 월을 물려받는다
  for (const m of desc.matchAll(/(?<!월\s*)(?<!\d)(\d{1,2})\s*일(?!\d)/g)) {
    const at = m.index ?? 0
    const prev = out.filter((c) => c.end <= at && at - c.end <= 40).pop()
    if (prev) push(m, +prev.ymd.slice(0, 4), +prev.ymd.slice(5, 7), +m[1])
  }
  return out.sort((a, b) => a.at - b.at)
}

export function extractDates(desc: string, published: string) {
  const c = candidates(desc, published)
  // 같은 줄 안에서만 본다. 다음 줄의 "당첨자 발표"가 앞 줄 마감일에 붙지 않게.
  const before = (x: Cand, n: number) => desc.slice(Math.max(0, x.at - n), x.at).split('\n').pop() ?? ''
  const after = (x: Cand, n: number) => desc.slice(x.end, x.end + n).split('\n')[0]
  const dlKw = c.find((x) => /까지|마감/.test(after(x, 6)) || /마감/.test(before(x, 15)))
  const ann = c.find((x) => x !== dlKw && /발표|추첨|당첨/.test(before(x, 15) + '\u0000' + after(x, 10)))
  const rest = c.filter((x) => x !== ann && !/^\s*부터/.test(after(x, 3)))   // "부터"가 붙은 건 시작일
  const dl = dlKw
    ?? rest.find((x) => /[~∼〜-]\s*$/.test(before(x, 3)))                 // 범위의 뒤쪽
    ?? rest.slice().sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : 0))[0]
  const deadline = dl?.ymd ?? addDays(published, 7)
  return { deadline, announce: ann?.ymd ?? addDays(deadline, 7), deadlineGuessed: !dl, announceGuessed: !ann }
}

/** 이벤트 키워드가 있는 첫 문단을 한 줄로. `|`·줄바꿈은 시트 파서가 자르므로 뺀다. */
export function excerpt(desc: string): string {
  const paras = desc.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const p = paras.find((x) => EVENT_RE.test(x)) ?? paras[0] ?? ''
  return p.replace(/\|/g, '/').slice(0, 300)
}

/** 감시 채널(사용자가 고른 채널)은 제목에 "이벤트"만 있어도 믿는다. 정가거부 "이벤트 #14" 는 설명에 참여 방법이 없었다. */
export const isTrustedEvent = (title: string, desc: string) => /이벤트/.test(title) || isEvent(title, desc)
/** 영상 하나 → 이벤트(아니면 null). force 는 사용자가 "이벤트 추가"로 직접 넣을 때, trusted 는 감시 채널 스캔. */
export function detect(s: Snippet, force = false, trusted = false): Event | null {
  if (!force && !(trusted ? isTrustedEvent : isEvent)(s.title, s.description)) return null
  const published = kstDate(Date.parse(s.publishedAt))
  return {
    id: s.videoId, channel: s.channelTitle, title: s.title, ...extractDates(s.description, published),
    excerpt: excerpt(s.description), status: 'new', note: '', found: published, updated: published,
    ...(s.comments !== undefined ? { comments: s.comments } : {}), ...(s.channelId ? { channelId: s.channelId } : {}),
  }
}

// ── 시트 행 ↔ 이벤트 ────────────────────────────────────────
const clean = (s: string) => s.replace(/[|\r\n]+/g, ' ').trim()
const mark = (ymd: string, guessed: boolean) => ymd + (guessed ? '?' : '')
/** "기록시각|videoId|new|채널|제목|마감|발표|발췌|댓글수|구독자수" (뒤 두 칸은 나중에 붙어서 옛 행엔 없다) */
export const newRow = (e: Event, stamp: string) =>
  [stamp, e.id, 'new', clean(e.channel), clean(e.title), mark(e.deadline, e.deadlineGuessed), mark(e.announce, e.announceGuessed), e.excerpt, e.comments ?? '', e.subs ?? ''].join('|')
export const statusRow = (id: string, status: Status, note: string, stamp: string) => [stamp, id, status, clean(note)].join('|')

/** 행들을 videoId 별로 접어 현재 상태만. new 행이 창(120일) 밖이면 그 이벤트는 사라진다 — 어차피 끝난 것. */
export function fold(rows: HealthRow[]): Event[] {
  const byId = new Map<string, Event>()
  const sorted = [...rows].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))   // 같은 시각이면 시트 순서
  for (const r of sorted) {
    const st = r.value as Status
    if (st === 'new') {
      const [channel = '', title = '', dl = '', an = '', ex = '', cm = '', sb = ''] = (r.extra ?? '').split('|')
      byId.set(r.end, {
        id: r.end, channel, title,
        deadline: dl.replace('?', ''), announce: an.replace('?', ''), deadlineGuessed: dl.endsWith('?'), announceGuessed: an.endsWith('?'),
        excerpt: ex, status: 'new', note: '', found: r.start.slice(0, 10), updated: r.start.slice(0, 10),
        ...(cm !== '' ? { comments: +cm } : {}), ...(sb !== '' ? { subs: +sb } : {}),
      })
    } else if (STATUSES.includes(st)) {
      const e = byId.get(r.end)
      if (e) { e.status = st; e.note = r.extra ?? ''; e.updated = r.start.slice(0, 10) }
    }
  }
  return [...byId.values()]
}

export type Groups = { pending: Event[]; applied: Event[]; results: Event[]; missed: Event[] }
export function group(events: Event[], today: string): Groups {
  const byDeadline = (a: Event, b: Event) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0)
  const open = events.filter((e) => e.status === 'new' || e.status === 'reminded')
  return {
    // 경쟁률(댓글 수) 낮은 것부터. 모르는 건 뒤로, 같으면 마감순
    pending: open.filter((e) => e.deadline >= today).sort((a, b) => (a.comments ?? 1e9) - (b.comments ?? 1e9) || byDeadline(a, b)),
    missed: open.filter((e) => e.deadline < today).sort(byDeadline),
    applied: events.filter((e) => e.status === 'applied').sort((a, b) => (a.announce < b.announce ? -1 : 1)),
    results: events.filter((e) => (e.status === 'won' || e.status === 'lost') && e.updated >= addDays(today, -30)),
  }
}

export const videoUrl = (id: string) => `https://youtu.be/${id}`
/** 단축어가 미리알림 2개를 만들 때 쓰는 값. 알림 시각은 ISO(+09:00)라 단축어가 그대로 날짜로 읽는다. */
export function reminderPayload(e: Event, today: string) {
  const remind = addDays(e.deadline, -1) < today ? today : addDays(e.deadline, -1)
  return {
    id: e.id, channel: e.channel, title: e.title, url: videoUrl(e.id),
    deadline: e.deadline, announce: e.announce, guessed: e.deadlineGuessed || e.announceGuessed,
    remindAt: `${remind}T09:00:00+09:00`, announceAt: `${e.announce}T09:00:00+09:00`, excerpt: e.excerpt, stats: stats(e),
  }
}

const md = (ymd: string, guessed = false) => ymd.slice(5) + (guessed ? '?' : '')
const head = (e: Event) => `• ${e.channel} · ${e.title}`
const fmtN = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만` : String(n))
/** "댓글 42 · 구독 3.2만" — 스캔 시점 값 */
const stats = (e: Event) => [e.comments !== undefined ? `댓글 ${fmtN(e.comments)}` : '', e.subs !== undefined ? `구독 ${fmtN(e.subs)}` : ''].filter(Boolean).join(' · ')
export function formatEvents(g: Groups, today: string): string {
  const out: string[] = [`이벤트 (${today})`]
  out.push(`\n[지원 대기 ${g.pending.length}]` + (g.pending.length ? ' — 댓글 적은(경쟁 낮은) 순' : ' 없음'))
  for (const e of g.pending) {
    out.push(head(e), `  마감 ${md(e.deadline, e.deadlineGuessed)} · 발표 ${md(e.announce, e.announceGuessed)}${stats(e) ? ' · ' + stats(e) : ''} · ${videoUrl(e.id)}`)
    if (e.excerpt) out.push(`  ${e.excerpt}`)
  }
  if (g.applied.length) {
    out.push(`\n[지원함 · 발표 대기 ${g.applied.length}]`)
    for (const e of g.applied) out.push(`${head(e)} — 발표 ${md(e.announce, e.announceGuessed)} · ${videoUrl(e.id)}`)
  }
  if (g.results.length) {
    out.push(`\n[결과 · 최근 30일 ${g.results.length}]`)
    for (const e of g.results) out.push(`${head(e)} — ${e.status === 'won' ? '당첨' : '탈락'} ${md(e.updated)}${e.note ? ' · ' + e.note : ''}`)
  }
  if (g.missed.length) {
    out.push(`\n[놓침 ${g.missed.length}]`)
    for (const e of g.missed) out.push(`${head(e)} — 마감 ${md(e.deadline)} 지남`)
  }
  return out.join('\n')
}

// ── 한 줄 문법 ──────────────────────────────────────────────
export type LogCmd =
  | { kind: 'status'; status: Status; query: string; note: string }
  | { kind: 'channel'; input: string; remove?: boolean }
  | { kind: 'video'; url: string; deadline?: string; announce?: string }
const STATUS_WORD: Record<string, Status> = { 지원: 'applied', 당첨: 'won', 탈락: 'lost', 패스: 'skipped', 스킵: 'skipped' }
const USAGE = '"지원 십만양품", "당첨 십만양품 에어프라이어", "탈락 키보드", "패스 이어폰", "채널 추가 @핸들", "채널 삭제 @핸들", "이벤트 추가 <영상URL> [마감 MM-DD] [발표 MM-DD]" 중 하나'

export function parseEventLog(text: string): LogCmd {
  const [h, ...rest] = text.trim().replace(/\s+/g, ' ').split(' ')
  if (h === '채널' && (rest[0] === '추가' || rest[0] === '삭제') && rest[1]) return { kind: 'channel', input: rest[1], ...(rest[0] === '삭제' ? { remove: true } : {}) }
  if (h === '이벤트' && rest[0] === '추가' && rest[1]) {
    const cmd: LogCmd = { kind: 'video', url: rest[1] }
    const opts = rest.slice(2).join(' ')
    const dl = /마감\s*(\d{2}-\d{2})/.exec(opts); if (dl) cmd.deadline = dl[1]
    const an = /발표\s*(\d{2}-\d{2})/.exec(opts); if (an) cmd.announce = an[1]
    return cmd
  }
  const status = STATUS_WORD[h]
  if (!status || !rest.length) throw new Error(`이벤트 기록은 ${USAGE}`)
  return { kind: 'status', status, query: rest[0], note: rest.slice(1).join(' ') }
}

export function parseChannelInput(s: string): { handle?: string; id?: string } | null {
  const id = /(?:^|\/channel\/)(UC[\w-]{20,})/.exec(s)
  if (id) return { id: id[1] }
  const h = /@([\w.-]+)/.exec(s)
  return h ? { handle: h[1] } : null
}
export function parseVideoInput(s: string): string | null {
  const m = /(?:youtu\.be\/|[?&]v=|shorts\/)([\w-]{11})/.exec(s)
  return m ? m[1] : null
}
/** 활성(new·reminded·applied) 이벤트 중 채널명·제목에 키워드가 든 것 */
export function findEvents(events: Event[], query: string): Event[] {
  const q = query.toLowerCase()
  return events.filter((e) => ACTIVE.includes(e.status) && (e.channel.toLowerCase().includes(q) || e.title.toLowerCase().includes(q)))
}

// ── YouTube Data API (키만, OAuth 없음) ─────────────────────
const API = 'https://www.googleapis.com/youtube/v3'
export const hasKey = () => !!process.env.YOUTUBE_API_KEY
async function yt<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new Error('YOUTUBE_API_KEY 환경변수가 없습니다')
  const u = new URL(`${API}/${path}`)
  Object.entries({ ...params, key }).forEach(([k, v]) => u.searchParams.set(k, v))
  const r = await fetch(u)
  if (!r.ok) throw new Error(`YouTube ${path} ${r.status}`)
  return await r.json() as T
}
type ApiSnippet = { title: string; description: string; publishedAt: string; channelTitle: string; resourceId?: { videoId: string } }

type ApiVideo = { id: string; snippet: ApiSnippet & { channelId: string; liveBroadcastContent?: string }; statistics?: { commentCount?: string } }
const chunk = <T,>(xs: T[], n: number): T[][] => xs.length ? [xs.slice(0, n), ...chunk(xs.slice(n), n)] : []

/** 채널 업로드 재생목록(UC→UU)의 최근 10개. 할당량 1단위. */
export async function recentUploads(ch: Channel): Promise<Snippet[]> {
  const r = await yt<{ items?: { snippet: ApiSnippet }[] }>('playlistItems', { part: 'snippet', maxResults: '10', playlistId: 'UU' + ch.id.slice(2) })
  return (r.items ?? []).map((i) => ({ videoId: i.snippet.resourceId?.videoId ?? '', title: i.snippet.title, description: i.snippet.description, publishedAt: i.snippet.publishedAt, channelTitle: ch.name || i.snippet.channelTitle, channelId: ch.id }))
}
/** 영상 여러 개의 설명 전문 + 댓글 수. 50개까지 한 호출(1단위). */
export async function videoDetails(ids: string[]): Promise<Snippet[]> {
  const out: Snippet[] = []
  for (const part of chunk(ids, 50)) {
    const r = await yt<{ items?: ApiVideo[] }>('videos', { part: 'snippet,statistics', id: part.join(',') })
    for (const v of r.items ?? []) out.push({
      videoId: v.id, title: v.snippet.title, description: v.snippet.description, publishedAt: v.snippet.publishedAt,
      channelTitle: v.snippet.channelTitle, channelId: v.snippet.channelId, comments: +(v.statistics?.commentCount ?? 0),
      live: !!v.snippet.liveBroadcastContent && v.snippet.liveBroadcastContent !== 'none',
    })
  }
  return out
}
export async function videoSnippet(videoId: string): Promise<Snippet> {
  const v = (await videoDetails([videoId]))[0]
  if (!v) throw new Error(`영상을 찾을 수 없습니다: ${videoId}`)
  return v
}
/** 채널 구독자 수. 50개까지 한 호출(1단위). 비공개면 빠진다. */
export async function channelSubs(ids: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  for (const part of chunk([...new Set(ids)], 50)) {
    const r = await yt<{ items?: { id: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>('channels', { part: 'statistics', id: part.join(',') })
    for (const c of r.items ?? []) if (c.statistics?.subscriberCount && !c.statistics.hiddenSubscriberCount) m.set(c.id, +c.statistics.subscriberCount)
  }
  return m
}
/** 최근 7일 "댓글 이벤트"·"구독자 이벤트" 검색. 검색은 1회 100단위라 하루 한 번만 부른다(scan 이 마커로 막는다). */
export const SEARCH_QUERIES = ['댓글 이벤트', '구독자 이벤트']
export async function searchVideoIds(today: string): Promise<string[]> {
  const after = `${addDays(today, -7)}T00:00:00Z`
  const ids = new Set<string>()
  await Promise.all(SEARCH_QUERIES.map(async (q) => {
    const r = await yt<{ items?: { id?: { videoId?: string } }[] }>('search', { part: 'id', type: 'video', order: 'date', maxResults: '50', q, publishedAfter: after, regionCode: 'KR', relevanceLanguage: 'ko' })
    for (const i of r.items ?? []) if (i.id?.videoId) ids.add(i.id.videoId)
  }))
  return [...ids]
}
export async function resolveChannel(input: string): Promise<Channel> {
  const p = parseChannelInput(input)
  if (!p) throw new Error('채널은 @핸들 또는 채널 URL 로 (예: 채널 추가 https://www.youtube.com/@100k-smyp)')
  const r = await yt<{ items?: { id: string; snippet: { title: string; customUrl?: string } }[] }>('channels', { part: 'snippet', ...(p.id ? { id: p.id } : { forHandle: '@' + p.handle }) })
  const c = r.items?.[0]
  if (!c) throw new Error(`채널을 찾을 수 없습니다: ${input}`)
  return { id: c.id, name: c.snippet.title, handle: c.snippet.customUrl ?? (p.handle ? '@' + p.handle : '') }
}

// ── 시트 입출력 ─────────────────────────────────────────────
export const EVENT_DAYS = 120
export const stampNow = () => logStamp('').stamp
export const SEARCH_MARK = '_search'
/** 채널·이벤트를 동시에 읽는다(GAS 호출은 각 10초라 직렬이면 20초). lastSearch 는 마지막 검색 스캔 시각(마커 행). */
export async function loadState(): Promise<{ channels: Channel[]; events: Event[]; lastSearch: string }> {
  const [ev, ch] = await Promise.all([
    gasGet<{ rows?: HealthRow[] }>('healthRows', `&type=events&days=${EVENT_DAYS}`),
    gasGet<{ rows?: HealthRow[] }>('healthRows', '&type=event_channels&days=3650'),
  ])
  const rows = ev.rows ?? []
  return { events: fold(rows), channels: foldChannels(ch.rows ?? []), lastSearch: lastSearchOf(rows) }
}
export const lastSearchOf = (rows: HealthRow[]) => rows.filter((r) => r.end === SEARCH_MARK).map((r) => r.start).sort().pop() ?? ''
/** 채널도 추가만 한다. value 가 '삭제' 인 행이 오면 그 채널을 뺀다(폰에서 "채널 삭제 @핸들"). 마지막 행이 이긴다. */
export function foldChannels(rows: HealthRow[]): Channel[] {
  const byId = new Map<string, Channel>()
  for (const r of [...rows].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))) {
    if (!r.end) continue
    if (r.value === '삭제') byId.delete(r.end)
    else byId.set(r.end, { id: r.end, name: r.value, handle: r.extra ?? '' })
  }
  return [...byId.values()]
}
export const saveRows = (type: 'events' | 'event_channels', rows: string[]) =>
  rows.length ? gasPost({ action: 'health', type, rows: rows.join('\n') }) : Promise.resolve(undefined)

/**
 * 새 이벤트 수집 → new 로 저장.
 *  ① 감시 채널마다 최근 10개(채널당 1단위)
 *  ② 하루 한 번 검색(2회 200단위) → 설명 전문·댓글 수(50개당 1단위) — 채널 목록 밖의 소규모 채널이 여기서 들어온다
 * 마감이 이미 지난 건 저장하지 않는다(놓침 목록만 늘린다). 채널 하나 실패는 건너뛰고 이름만 남긴다.
 */
export async function scan(channels: Channel[], known: Event[], lastSearch = '', today = kstDate(Date.now())): Promise<{ added: Event[]; errors: string[]; scanned: number; searched: boolean }> {
  if (!hasKey()) return { added: [], errors: ['YOUTUBE_API_KEY 없음 — 스캔 생략'], scanned: 0, searched: false }
  const seen = new Set(known.map((e) => e.id))
  const added: Event[] = []; const errors: string[] = []
  const take = (s: Snippet, fromSearch = false) => {
    if (!s.videoId || seen.has(s.videoId) || s.live) return
    const e = detect(s, false, !fromSearch)
    if (e && e.deadline >= today) { seen.add(e.id); added.push(fromSearch ? { ...e, fromSearch } : e) }
  }
  const searched = lastSearch.slice(0, 10) !== today
  await Promise.all([
    ...channels.map(async (ch) => {
      try { (await recentUploads(ch)).forEach((s) => take(s)) }
      catch (err) { errors.push(`${ch.name || ch.id}: ${err instanceof Error ? err.message : err}`) }
    }),
    (async () => {
      if (!searched) return
      try { (await videoDetails((await searchVideoIds(today)).filter((id) => !seen.has(id)))).filter(isSearchWorthy).forEach((s) => take(s, true)) }
      catch (err) { errors.push(`검색: ${err instanceof Error ? err.message : err}`) }
    })(),
  ])
  // 경쟁률: 채널 스캔에서 온 건 댓글 수가 없으니 채워 넣고(50개당 1단위), 구독자 수는 전부(50채널당 1단위)
  try {
    const noStats = added.filter((e) => e.comments === undefined)
    const details = new Map((await videoDetails(noStats.map((e) => e.id))).map((s) => [s.videoId, s]))
    for (const e of noStats) { const d = details.get(e.id); if (d) e.comments = d.comments }
    const subs = await channelSubs(added.map((e) => e.channelId ?? '').filter(Boolean))
    for (const e of added) { const n = e.channelId ? subs.get(e.channelId) : undefined; if (n !== undefined) e.subs = n }
  } catch (err) { errors.push(`통계: ${err instanceof Error ? err.message : err}`) }
  // 검색으로 온 건 구독자 1천 미만(또는 비공개)이면 버린다. 감시 채널은 사용자가 고른 것이라 그대로.
  const kept = added.filter((e) => !e.fromSearch || (e.subs ?? 0) >= SEARCH_MIN_SUBS)
  const stamp = stampNow()
  await saveRows('events', [...kept.map((e) => newRow(e, stamp)), ...(searched ? [[stamp, SEARCH_MARK, 'scan', SEARCH_QUERIES.join(',')].join('|')] : [])])
  return { added: kept, errors, scanned: channels.length - errors.filter((x) => !/^(검색|통계):/.test(x)).length, searched }
}
