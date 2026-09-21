import { describe, it, expect } from 'vitest'
import {
  isEvent, extractDates, excerpt, detect, fold, group, newRow, reminderPayload, formatEvents,
  parseEventLog, parseChannelInput, parseVideoInput, findEvents, mmddToYmd, type Snippet,
} from './_events'
import type { HealthRow } from './_health'

const DESC_A = `오늘은 에어프라이어 5종 비교입니다.

🎁 구독자 이벤트
영상 보시고 댓글로 가장 마음에 드는 제품을 남겨주세요!
이벤트 기간: 9월 21일 ~ 9월 28일
당첨자 발표: 9월 30일 (커뮤니티 게시글)

#에어프라이어 #리뷰`

const DESC_B = `[협찬] 본 영상은 유료 광고를 포함합니다.
구독과 좋아요 부탁드려요.
10/5까지 댓글 남겨주시면 추첨을 통해 2분께 선물을 드립니다. 10/7 당첨자 발표.
문의: 010-1234-5678 · 가격 9.900원`

const snip = (over: Partial<Snippet> = {}): Snippet => ({
  videoId: 'abc123DEF45', title: '에어프라이어 끝판왕은?', description: DESC_A,
  publishedAt: '2026-09-21T03:00:00Z', channelTitle: '십만양품', ...over,
})

describe('판정', () => {
  it('이벤트 키워드와 참여 키워드가 둘 다 있어야 한다', () => {
    expect(isEvent('에어프라이어', DESC_A)).toBe(true)
    expect(isEvent('협찬 리뷰', '구독과 좋아요 부탁드려요')).toBe(false)         // 구독만
    expect(isEvent('이벤트 결과', '지난 이벤트 결과를 알려드립니다')).toBe(false)  // 이벤트만
    expect(isEvent('구독자 이벤트!', '')).toBe(true)                            // 제목만으로도
  })
})

describe('날짜', () => {
  it('범위의 뒤쪽이 마감, 발표 키워드 옆이 발표일', () => {
    expect(extractDates(DESC_A, '2026-09-21')).toEqual({ deadline: '2026-09-28', announce: '2026-09-30', deadlineGuessed: false, announceGuessed: false })
  })
  it('슬래시 날짜와 "까지", 전화번호·가격은 무시', () => {
    expect(extractDates(DESC_B, '2026-09-30')).toEqual({ deadline: '2026-10-05', announce: '2026-10-07', deadlineGuessed: false, announceGuessed: false })
  })
  it('연도가 넘어가면 다음 해, 게시일보다 90일 넘게 뒤면 버림', () => {
    const d = extractDates('1월 5일까지 댓글! 발표는 1월 8일', '2026-12-28')
    expect(d.deadline).toBe('2027-01-05'); expect(d.announce).toBe('2027-01-08')
    expect(extractDates('12월 25일까지', '2026-09-01').deadlineGuessed).toBe(true)
  })
  it('날짜가 없으면 게시일+7, 발표는 마감+7, 추정 표시', () => {
    expect(extractDates('댓글 이벤트 합니다', '2026-09-21')).toEqual({ deadline: '2026-09-28', announce: '2026-10-05', deadlineGuessed: true, announceGuessed: true })
  })
  it('마감만 있으면 발표만 추정', () => {
    const d = extractDates('9월 25일까지 댓글 남겨주세요', '2026-09-21')
    expect(d).toMatchObject({ deadline: '2026-09-25', announce: '2026-10-02', deadlineGuessed: false, announceGuessed: true })
  })
  it('mmdd → 올해, 지났으면 내년', () => {
    expect(mmddToYmd('10-05', '2026-09-21')).toBe('2026-10-05')
    expect(mmddToYmd('01-05', '2026-12-20')).toBe('2027-01-05')
  })
})

describe('발췌·행', () => {
  it('이벤트 키워드가 있는 문단을 한 줄로', () => {
    const x = excerpt(DESC_A)
    expect(x.startsWith('🎁 구독자 이벤트 영상 보시고')).toBe(true)
    expect(x).not.toMatch(/\n|\|/)
  })
  it('detect → newRow → fold 왕복', () => {
    const e = detect(snip())!
    expect(e).toMatchObject({ id: 'abc123DEF45', channel: '십만양품', deadline: '2026-09-28', announce: '2026-09-30', status: 'new' })
    const row = newRow(e, '2026-09-21 09:00:00')
    expect(row.startsWith('2026-09-21 09:00:00|abc123DEF45|new|십만양품|에어프라이어 끝판왕은?|2026-09-28|2026-09-30|')).toBe(true)
    const [start, end, value, ...extra] = row.split('|')
    const back = fold([{ start, end, value, extra: extra.join('|') }])[0]
    expect(back).toMatchObject({ id: e.id, title: e.title, deadline: e.deadline, announce: e.announce, excerpt: e.excerpt, deadlineGuessed: false })
  })
  it('추정 날짜는 ? 로 남았다가 돌아온다', () => {
    const e = detect(snip({ description: '댓글 이벤트 합니다' }))!
    const row = newRow(e, '2026-09-21 09:00:00')
    expect(row).toContain('|2026-09-28?|2026-10-05?|')
    const [start, end, value, ...extra] = row.split('|')
    expect(fold([{ start, end, value, extra: extra.join('|') }])[0]).toMatchObject({ deadline: '2026-09-28', deadlineGuessed: true, announceGuessed: true })
  })
  it('비이벤트는 null, force 면 통과', () => {
    expect(detect(snip({ title: '리뷰', description: '그냥 리뷰' }))).toBeNull()
    expect(detect(snip({ title: '리뷰', description: '그냥 리뷰' }), true)?.status).toBe('new')
  })
})

const rows: HealthRow[] = [
  { start: '2026-09-10 09:00:00', end: 'v1', value: 'new', extra: '십만양품|에어프라이어|2026-09-18|2026-09-20|발췌1' },
  { start: '2026-09-10 09:00:01', end: 'v1', value: 'reminded', extra: '' },
  { start: '2026-09-12 09:00:00', end: 'v2', value: 'new', extra: '디에디트|키보드|2026-09-25|2026-09-27|발췌2' },
  { start: '2026-09-12 09:00:01', end: 'v2', value: 'reminded', extra: '' },
  { start: '2026-09-13 20:00:00', end: 'v2', value: 'applied', extra: '' },
  { start: '2026-09-15 09:00:00', end: 'v3', value: 'new', extra: '기즈모|이어폰|2026-09-30?|2026-10-07?|발췌3' },
  { start: '2026-09-01 09:00:00', end: 'v4', value: 'new', extra: '십만양품|청소기|2026-09-05|2026-09-07|발췌4' },
  { start: '2026-09-08 09:00:00', end: 'v4', value: 'won', extra: '청소기 30만' },
  { start: '2026-09-16 09:00:00', end: 'v5', value: 'new', extra: '십만양품|모니터|2026-09-22|2026-09-24|발췌5' },
  { start: '2026-09-16 09:00:01', end: 'v5', value: 'skipped', extra: '' },
]

describe('상태 접기·묶기', () => {
  it('마지막 행이 상태, 메모·갱신일 포함', () => {
    const m = new Map(fold(rows).map((e) => [e.id, e]))
    expect(m.get('v1')).toMatchObject({ status: 'reminded' })
    expect(m.get('v2')).toMatchObject({ status: 'applied', updated: '2026-09-13' })
    expect(m.get('v4')).toMatchObject({ status: 'won', note: '청소기 30만' })
    expect(m.size).toBe(5)
  })
  it('지원 대기(마감순)·지원함·결과·놓침, 패스는 제외', () => {
    const g = group(fold(rows), '2026-09-21')
    expect(g.pending.map((e) => e.id)).toEqual(['v3'])
    expect(g.applied.map((e) => e.id)).toEqual(['v2'])
    expect(g.results.map((e) => e.id)).toEqual(['v4'])
    expect(g.missed.map((e) => e.id)).toEqual(['v1'])
  })
  it('미리알림 페이로드: 마감 전날 09:00, 오늘보다 앞서지 않게', () => {
    const e = fold(rows).find((x) => x.id === 'v3')!
    const p = reminderPayload(e, '2026-09-21')
    expect(p).toMatchObject({ url: 'https://youtu.be/v3', remindAt: '2026-09-29T09:00:00+09:00', announceAt: '2026-10-07T09:00:00+09:00', guessed: true })
    expect(reminderPayload(e, '2026-09-30').remindAt).toBe('2026-09-30T09:00:00+09:00')
  })
  it('텍스트 형식에 네 묶음이 다 나온다', () => {
    const t = formatEvents(group(fold(rows), '2026-09-21'), '2026-09-21')
    expect(t).toContain('지원 대기 1'); expect(t).toContain('이어폰'); expect(t).toContain('09-30?')
    expect(t).toContain('놓침 1'); expect(t).toContain('청소기 30만')
  })
})

describe('한 줄 문법', () => {
  it('상태 네 가지', () => {
    expect(parseEventLog('지원 십만양품')).toEqual({ kind: 'status', status: 'applied', query: '십만양품', note: '' })
    expect(parseEventLog('당첨 십만양품 에어프라이어 15만')).toEqual({ kind: 'status', status: 'won', query: '십만양품', note: '에어프라이어 15만' })
    expect(parseEventLog('탈락 키보드').status).toBe('lost')
    expect(parseEventLog('패스 이어폰').status).toBe('skipped')
    expect(() => parseEventLog('지원')).toThrow()
    expect(() => parseEventLog('먹었다 김밥')).toThrow()
  })
  it('채널·이벤트 추가', () => {
    expect(parseEventLog('채널 추가 https://www.youtube.com/@100k-smyp')).toEqual({ kind: 'channel', input: 'https://www.youtube.com/@100k-smyp' })
    expect(parseEventLog('이벤트 추가 https://youtu.be/abc123DEF45 마감 10-05 발표 10-07'))
      .toEqual({ kind: 'video', url: 'https://youtu.be/abc123DEF45', deadline: '10-05', announce: '10-07' })
    expect(parseEventLog('이벤트 추가 https://youtu.be/abc123DEF45')).toEqual({ kind: 'video', url: 'https://youtu.be/abc123DEF45' })
  })
  it('채널 입력: 핸들·채널 URL·ID', () => {
    expect(parseChannelInput('https://www.youtube.com/@100k-smyp')).toEqual({ handle: '100k-smyp' })
    expect(parseChannelInput('@theedit')).toEqual({ handle: 'theedit' })
    expect(parseChannelInput('https://www.youtube.com/channel/UC-MF5bBExsufzZJtvp0Jbsg')).toEqual({ id: 'UC-MF5bBExsufzZJtvp0Jbsg' })
    expect(parseChannelInput('UCAtwlPw7NFwpJ4FL70hpwtg')).toEqual({ id: 'UCAtwlPw7NFwpJ4FL70hpwtg' })
    expect(parseChannelInput('십만양품')).toBeNull()
  })
  it('영상 URL 세 가지 꼴', () => {
    expect(parseVideoInput('https://youtu.be/abc123DEF45')).toBe('abc123DEF45')
    expect(parseVideoInput('https://www.youtube.com/watch?v=abc123DEF45&t=10')).toBe('abc123DEF45')
    expect(parseVideoInput('https://youtube.com/shorts/abc123DEF45')).toBe('abc123DEF45')
    expect(parseVideoInput('abc')).toBeNull()
  })
  it('키워드 매칭은 활성 이벤트의 채널·제목만, 대소문자 무시', () => {
    const es = fold(rows)
    expect(findEvents(es, '십만양품').map((e) => e.id)).toEqual(['v1'])   // v4 는 끝남, v5 는 패스
    expect(findEvents(es, '키보드').map((e) => e.id)).toEqual(['v2'])
    expect(findEvents(es, '없음')).toEqual([])
  })
})
