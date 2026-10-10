import { describe, it, expect } from 'vitest'
import {
  isEvent, extractDates, excerpt, detect, fold, group, newRow, reminderPayload, formatEvents,
  parseEventLog, parseChannelInput, parseVideoInput, findEvents, mmddToYmd, foldChannels, lastSearchOf, SEARCH_MARK, isSearchWorthy, isTrustedEvent, winnerHints, needsResultCheck, gradeRow, worthOf, type Snippet,
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
  it('"부터 … 일까지": 시작일은 제외, 월 없는 날은 앞 날짜의 월 (실제 디에디트 공지)', () => {
    const d = extractDates('😎9월 18일부터 30일까지 사전예약으로 구매하시면 특별한 혜택이 있어요!', '2026-09-17')
    expect(d).toMatchObject({ deadline: '2026-09-30', deadlineGuessed: false, announceGuessed: true })
    // 앞에 날짜가 없으면 "30일" 만으로는 후보가 안 된다
    expect(extractDates('30일 무이자 할부', '2026-09-17').deadlineGuessed).toBe(true)
  })
  it('실제 십만양품 공지: 게시일보다 앞선 날짜(옛 공지 복붙)는 버리고 추정 표시', () => {
    const d = extractDates('기간 : 2026.05.26(화) PM 11:59 까지 당첨자 발표 : 2026.05.27(수)', '2026-09-06')
    expect(d).toMatchObject({ deadline: '2026-09-13', deadlineGuessed: true, announceGuessed: true })
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
  it('댓글 수·구독자 수는 행 끝에 붙고, 옛 행(없음)도 그대로 읽힌다', () => {
    const e = detect(snip({ comments: 42, channelId: 'UCx' }))!
    e.subs = 32000
    const row = newRow(e, '2026-09-21 09:00:00')
    expect(row.endsWith('|42|32000')).toBe(true)
    const [start, end, value, ...extra] = row.split('|')
    expect(fold([{ start, end, value, extra: extra.join('|') }])[0]).toMatchObject({ comments: 42, subs: 32000, excerpt: e.excerpt })
    const old = fold([{ start, end, value, extra: '십만양품|제목|2026-09-28|2026-09-30|발췌' }])[0]
    expect(old.comments).toBeUndefined(); expect(old.excerpt).toBe('발췌')
  })
  it('검색 결과 거르기: 경품 언급·라이브 아님·결과 영상 아님 (실검색 사례)', () => {
    expect(isSearchWorthy(snip({ title: '[#EVENT] 에어다운 압축 파우치 "신제품 증정" 이벤트🎁', description: '구독과 좋아요 후 댓글' }))).toBe(true)
    expect(isSearchWorthy(snip({ title: '[💜구독이벤트] APEX 6 PRO 출시! 나오자마자 20000대 순삭', description: '0:00 인트로\n10:54 구독이벤트' }))).toBe(true)  // 경품은 영상 안에서만
    expect(isSearchWorthy(snip({ title: '구독자 200명 되면 친추 이벤트 하겠습니다', description: '댓글에 닉네임' }))).toBe(false)  // 경품 없음
    expect(isSearchWorthy(snip({ title: '✨ 구독자 이벤트 선정 결과 ✨', description: '선물 발송' }))).toBe(false)                 // 결과 영상
    expect(isSearchWorthy(snip({ title: '구독자 나눔 이벤트 라이브 경품 추첨', description: '', live: true }))).toBe(false)     // 라이브
  })
  it('감시 채널은 제목에 "이벤트"만 있어도 잡는다 (정가거부 이벤트 #14: 설명에 참여 방법 없음)', () => {
    const s = snip({ title: '정가거부 이벤트 #14', description: 'https://www.moyoplan.com/s/x\n\n오늘의핫딜\nhttps://link' })
    expect(isTrustedEvent(s.title, s.description)).toBe(true)
    expect(detect(s)).toBeNull()
    expect(detect(s, false, true)).toMatchObject({ status: 'new', deadlineGuessed: true })
    expect(isTrustedEvent('반값 할인 시작', '구독 좋아요')).toBe(false)
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
  it('지원 대기는 댓글 적은 순, 모르면 뒤로', () => {
    const es = fold([
      { start: '2026-09-20 09:00:00', end: 'a', value: 'new', extra: '큰채널|A|2026-09-30|2026-10-05|x|5200|900000' },
      { start: '2026-09-20 09:00:00', end: 'b', value: 'new', extra: '작은채널|B|2026-09-25|2026-09-27|x|38|4100' },
      { start: '2026-09-20 09:00:00', end: 'c', value: 'new', extra: '옛행|C|2026-09-23|2026-09-24|x' },
    ])
    const g = group(es, '2026-09-21')
    expect(g.pending.map((e) => e.id)).toEqual(['b', 'a', 'c'])
    const t = formatEvents(g, '2026-09-21')
    expect(t).toContain('댓글 38 · 구독 4100'); expect(t).toContain('댓글 5200 · 구독 90만')
  })
  it('검색 마커: 마지막 검색 시각', () => {
    expect(lastSearchOf([])).toBe('')
    expect(lastSearchOf([
      { start: '2026-09-20 09:00:00', end: SEARCH_MARK, value: 'scan', extra: '' },
      { start: '2026-09-21 09:00:00', end: SEARCH_MARK, value: 'scan', extra: '' },
      { start: '2026-09-21 10:00:00', end: 'v1', value: 'new', extra: 'a|b|2026-09-30|2026-10-01|x' },
    ])).toBe('2026-09-21 09:00:00')
    // 마커 행은 이벤트로 접히지 않는다
    expect(fold([{ start: '2026-09-21 09:00:00', end: SEARCH_MARK, value: 'scan', extra: '' }])).toEqual([])
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
  it('채널 삭제 행은 무덤돌: 마지막 행이 이긴다', () => {
    const ch = foldChannels([
      { start: '2026-09-21 10:00:00', end: 'UC1', value: '십만양품', extra: '@100k-smyp' },
      { start: '2026-09-21 10:00:00', end: 'UC2', value: '엉뚱', extra: '@theedit' },
      { start: '2026-09-21 11:00:00', end: 'UC2', value: '삭제', extra: '' },
      { start: '2026-09-21 12:00:00', end: 'UC3', value: '디에디트', extra: '@the-edit' },
    ])
    expect(ch.map((c) => c.name)).toEqual(['십만양품', '디에디트'])
  })
  it('채널·이벤트 추가', () => {
    expect(parseEventLog('채널 추가 https://www.youtube.com/@100k-smyp')).toEqual({ kind: 'channel', input: 'https://www.youtube.com/@100k-smyp' })
    expect(parseEventLog('채널 삭제 @theedit')).toEqual({ kind: 'channel', input: '@theedit', remove: true })
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

describe('당첨자 자동 검사', () => {
  const H = '@김강환-b1q', CH = 'UCchannel'
  const mine = (replies: { authorId: string; text: string }[] = []) => ({ author: H, authorId: 'UCme', text: '참여합니다!', replies })
  it('영상 설명·채널 댓글·내 댓글에 채널 답글·새 영상 — 네 곳', () => {
    expect(winnerHints(H, CH, { description: '당첨자: @김강환-b1q, @홍길동-xx' }, [], [])).toEqual(['영상 설명에 내 핸들'])
    expect(winnerHints(H, CH, { description: '' }, [{ author: '@채널', authorId: CH, text: '🎉 당첨자 발표\n@김강환-b1q 님 축하드립니다', replies: [] }], [])[0]).toMatch(/^채널 댓글에 내 핸들/)
    expect(winnerHints(H, CH, { description: '' }, [mine([{ authorId: CH, text: '당첨되셨어요! 주소 보내주세요' }])], [])).toEqual(['채널이 내 댓글에 답글: 당첨되셨어요! 주소 보내주세요'])
    expect(winnerHints(H, CH, { description: '' }, [], [{ title: '이벤트 당첨자 발표', description: '@김강환-b1q 님' }])).toEqual(['새 영상에 내 핸들: 이벤트 당첨자 발표'])
  })
  it('오탐 방지: 내 댓글 자체, 다른 사람의 답글, 핸들 없음', () => {
    expect(winnerHints(H, CH, { description: '' }, [mine([{ authorId: 'UCother', text: '저도요' }])], [])).toEqual([])
    expect(winnerHints(H, CH, { description: '' }, [{ author: H, authorId: 'UCme', text: '@김강환-b1q 입니다', replies: [] }], [])).toEqual([])
    expect(winnerHints('', CH, { description: '김강환-b1q' }, [], [])).toEqual([])
  })
  it('검사 대상: 지원함 · 발표일 지남 · 30일 이내 · 후보 없음', () => {
    const base = fold([{ start: '2026-09-01 09:00:00', end: 'v', value: 'new', extra: 'c|t|2026-09-10|2026-09-12|x' }, { start: '2026-09-05 09:00:00', end: 'v', value: 'applied', extra: '' }])[0]
    expect(needsResultCheck(base, '2026-09-11')).toBe(false)
    expect(needsResultCheck(base, '2026-09-12')).toBe(true)
    expect(needsResultCheck(base, '2026-10-13')).toBe(false)
    expect(needsResultCheck({ ...base, hint: '이미' }, '2026-09-12')).toBe(false)
    expect(needsResultCheck({ ...base, status: 'reminded' }, '2026-09-12')).toBe(false)
  })
  it('hint 행은 상태를 바꾸지 않고 붙는다', () => {
    const e = fold([
      { start: '2026-09-01 09:00:00', end: 'v', value: 'new', extra: 'c|t|2026-09-10|2026-09-12|x' },
      { start: '2026-09-05 09:00:00', end: 'v', value: 'applied', extra: '' },
      { start: '2026-09-12 09:00:00', end: 'v', value: 'hint', extra: '채널이 내 댓글에 답글: 축하' },
    ])[0]
    expect(e).toMatchObject({ status: 'applied', hint: '채널이 내 댓글에 답글: 축하' })
    expect(formatEvents(group([e], '2026-09-13'), '2026-09-13')).toContain('당첨 후보 — 채널이 내 댓글에 답글')
  })
})

describe('채점(grade)', () => {
  const base = (id: string, comments: number) => ({ start: '2026-09-20 09:00:00', end: id, value: 'new', extra: `c|${id}|2026-09-30|2026-10-05|x|${comments}|1000` })
  it('grade 행이 붙고 왕복한다', () => {
    const row = gradeRow('a', { prize: '피규어|굿즈 50만원', value: 500000, winners: 1, worth: 4 }, '2026-09-21 09:00:00')
    expect(row).toBe('2026-09-21 09:00:00|a|grade|500000|1|4|피규어 굿즈 50만원')
    const [start, end, value, ...extra] = row.split('|')
    const e = fold([base('a', 10), { start, end, value, extra: extra.join('|') }])[0]
    expect(e.grade).toEqual({ prize: '피규어 굿즈 50만원', value: 500000, winners: 1, worth: 4 })
  })
  it('지원 대기는 응모가치 순, 미채점은 중간(2.5), 낮은 건 목록에서 생략', () => {
    const es = fold([
      base('low', 0), { start: '2026-09-21 09:00:00', end: 'low', value: 'grade', extra: '3000|5|2|상품권 3천원' },
      base('none', 5),
      base('high', 300), { start: '2026-09-21 09:00:00', end: 'high', value: 'grade', extra: '500000|1|4|피규어' },
    ])
    const g = group(es, '2026-09-21')
    expect(g.pending.map((e) => e.id)).toEqual(['high', 'none', 'low'])
    expect(worthOf(es.find((e) => e.id === 'none')!)).toBe(2.5)
    const t = formatEvents(g, '2026-09-21')
    expect(t).toContain('응모가치 4/5'); expect(t).toContain('미채점'); expect(t).toContain('응모가치 2 이하 1건 생략'); expect(t).not.toContain('상품권 3천원')
  })
})
