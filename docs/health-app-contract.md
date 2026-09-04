# 건강 앱 계약 (health.html ↔ /api/health)

이 문서는 **두 워커가 병렬로 작업하기 위한 고정 계약**이다. 여기 적힌 JSON 모양이 진실이고,
`public/health-fixture.json` 이 그 실제 예시다. 서로의 파일을 건드리지 않는다.

| 워커 | 소유 파일 | 금지 |
|---|---|---|
| A (API) | `api/health.ts`, `api/_plan.ts`(신규), `api/_health.ts`, `api/_log.ts`, `api/_readiness.ts`, `api/*.test.ts` | `public/**` 수정 금지 |
| B (UI) | `public/health.html`, `public/health.css`(선택), `public/health.js`(선택) | `api/**` 수정 금지 |

공통 금지: `vercel` 배포 금지(코디네이터가 함), `gas/**` 수정 금지, git commit 금지(코디네이터가 함), `.env` 출력 금지.

## 배경

애플워치 → iOS 단축어 → Google Sheet(탭 13개) → Vercel API. 시트 원본은 이미 9년치 백필돼 있다.
사용자는 30대 남성, 월수금 수영(~55분 850~1200m), 다음 주부터 화목 요가·러닝(초보)·턱걸이(초보) 추가,
매일 강아지 산책 1~2시간. 취침 01:00~01:30, 총수면 5.5~7.7시간.

지금 화면(`public/health.html`, 202줄)은 프로토타입이다. **상품 수준으로 다시 만든다.**

## GET /api/health → 200 JSON

쿠키 인증(`verify(req.headers.cookie, APP_SECRET)`). 실패 시 `401 {"ok":false,"error":"unauthorized"}`.
서버 오류도 **200 + `{"ok":false,"error":"..."}`** 로 돌려준다(화면이 항상 렌더되도록).

전체 예시는 `public/health-fixture.json`. 필드 규칙:

```jsonc
{
  "ok": true,
  "today": "2026-09-04",              // KST
  "generatedAt": "2026-09-04T13:20:00+09:00",
  "staleness": {                       // 화면 상단 경고용
    "lastUploadAt": "2026-09-04 08:12",// manual/자동 업로드가 마지막으로 남긴 흔적(가장 최근 시트 행 시각)
    "sleepToday": true,                // 오늘 밤 수면이 들어와 있나
    "workoutSince": "2026-09-02 09:15",// 마지막 운동 세션 시각
    "hint": "오늘 운동이 아직 안 올라왔어요"  // 없으면 null
  },

  "readiness": {
    "score": 68,                        // 0~100 정수. 기준선 부족이면 null
    "band": "계획대로",                  // 강하게 해도 됨 | 계획대로 | 가볍게 | 휴식 | 기준선 축적 중
    "headline": "무리 없이 계획대로 하면 되는 날이에요.",
    "lines": [ { "text": "잠 6시간 41분 — 평소보다 1시간 02분 더 잠", "tone": "good" } ],
    // tone: good | neutral | warn | bad
    "components": [                     // 8개 고정, 없으면 생략
      { "key": "hrv7", "label": "HRV 7일 평균", "score": 47, "weight": 0.30, "z": -0.1,
        "text": "HRV 7일 평균 38ms (평소 39, -2%)", "tone": "neutral" }
    ]
  },

  "sleep": {
    "lastNight": { "date": "2026-09-04", "bed": "01:27", "wake": "06:58",
      "totalMin": 401, "deepMin": 53, "remMin": 103, "coreMin": 174, "awakeMin": 1, "awakenings": 1,
      "vsBaselineMin": -12, "baselineMin": 413 },      // 기록 없으면 lastNight: null
    "recent": [ { "date": "2026-09-01", "totalMin": 465, "bed": "01:32", "wake": "09:35", "deepMin": 63 } ],
    "bedtimeMedian": "01:20", "bedtimeSdMin": 13,      // 최근 14일
    "debtMin": -85                                      // 7일 평균 - 60일 평균 (음수면 부족)
  },

  "metrics": {                          // 화면 스파크라인용. 없는 지표는 키 자체를 생략
    "hrv":            { "label": "HRV", "unit": "ms", "today": 45, "avg7": 38, "avg30": 39,
                        "betterWhen": "high", "series": [ { "date": "2026-08-28", "v": 37 } ] },
    "resting_hr":     { "label": "안정심박", "unit": "", "betterWhen": "low", ... },
    "active_kcal":    { "label": "활동", "unit": "kcal", "betterWhen": "high", ... },
    "steps":          { "label": "걸음", "unit": "", "betterWhen": "high", ... },
    "respiratory_rate": { "label": "호흡", "unit": "/분", "betterWhen": "low", ... },
    "wrist_temp":     { "label": "손목온도", "unit": "°", "betterWhen": "low", ... }
  },

  "workouts": [                         // 최근 14일, 최신순
    { "id": "2026-09-02 09:15|Swimming", "date": "2026-09-02", "start": "09:15",
      "type": "Swimming", "ko": "수영", "minutes": 56,
      "distanceM": 850, "distanceText": "850m", "kcal": 218, "hr": 113,
      "rpe": null, "note": null,        // manual 탭 sRPE 행과 매칭되면 채움
      "loggedAt": null }
  ],

  "wellness": {
    "today": { "values": [4,3,2,3], "at": "22:09" },   // 없으면 null
    "labels": ["수면질","피로","스트레스","근육통"],
    "recent": [ { "date": "2026-09-03", "values": [2,1,3,2] } ],   // 최근 14일
    "baseline": [ { "mean": 3.4, "sd": 0.8 }, ... ]    // 4항목, 30일. 데이터 부족이면 null
  },

  "tags":   { "today": ["술"], "recent": [ { "date": "2026-09-03", "tags": ["술","늦은식사"] } ] },
  "notes":  [ { "date": "2026-09-03", "time": "21:30", "text": "..." } ],   // 메모 kind, 최근 14일
  "pain":   [ { "date": "2026-09-03", "site": "무릎", "level": 3, "note": "" } ],
  "pullups":{ "recent": [ { "date": "2026-09-02", "variant": "밴드", "sets": 3, "reps": "5", "total": 15 } ],
              "monthTotal": 45, "maxSet": 5 },
  "inbody": [ { "date": "2026-08-01", "weight": 72.3, "smm": 33.1, "fat": 18.5 } ],

  "plan": {
    "week": [ { "date": "2026-09-04", "wd": "금", "isToday": true, "isPast": false,
                "items": [ { "name": "수영", "rest": false, "done": true,
                             "doneBy": "watch",           // watch | log | null
                             "detailKey": "수영" } ] } ],
    "done": 2, "planned": 4,
    "adherence4w": 0.72,               // 최근 4주 계획 대비 실행률. 데이터 부족이면 null
    "library": { "수영": { /* 아래 PlanDetail */ } }
  },

  "trends": {                           // 종목별 월간, 최근 6개월
    "swimming": [ { "month": "2026-08", "sessions": 8, "minutes": 420, "distanceM": 8200, "hr": 118 } ],
    "running":  [ { "month": "2026-08", "sessions": 2, "minutes": 60, "distanceM": 8000,
                    "paceSecPerKm": 450, "hr": 138 } ],
    "load": [ { "week": "2026-08-31", "srpe": 330, "sessions": 2 } ]   // 최근 8주 sRPE 주간 합
  },

  "alerts": [                           // 화면 상단 배너. 없으면 빈 배열
    { "level": "warn", "text": "이번 주 훈련 부하가 이전 4주 평균보다 34% 높아요", "key": "load_spike" }
  ]
}
```

### PlanDetail (plan.library 값)

훈련 계획을 **설명할 수 있게** 만드는 게 이번 작업의 핵심 요구다. 각 종목은 아래를 갖는다.
근거는 리서치에서 확정된 것만 쓴다(아래 "근거" 참고). 문구는 한국어, 존댓말 없이 담백하게.

```jsonc
{
  "name": "수영",
  "emoji": "🏊",                        // 하나
  "summary": "주 3회, 회당 50~60분. 지금 루틴의 중심.",
  "target": "회당 850~1200m, 평균심박 110~125",
  "how": [ "워밍업 200m 자유형 편하게", "메인 25m×8~12 세트, 세트 간 30초", "쿨다운 100m" ],
  "progression": "4주 동안 같은 거리를 유지하다가, 편해지면 세트 수를 1~2개씩 늘린다.",
  "why": "가장 오래 해온 종목이고 관절 부담이 낮아 다른 운동의 토대가 된다.",
  "cautions": [ "어깨 통증 3/10 이상이면 그날은 킥판 위주로" ],
  "readinessRule": {                    // 준비도 밴드별 조정. 4개 키 모두 필수
    "강하게 해도 됨": "세트 1~2개 추가",
    "계획대로": "계획대로",
    "가볍게": "거리 20% 줄이고 페이스 낮게",
    "휴식": "물에 들어가더라도 200m 이내 회복 수영"
  },
  "logHint": "끝나고 힘든 정도(1~10)와 한 줄 코멘트"
}
```

라이브러리에 **반드시 포함**: `수영`, `걷뛰`, `요가`, `턱걸이`. `휴식`은 detailKey `휴식`로 간단히.
`러닝`/`달리기`는 `걷뛰`와 같은 항목을 가리켜도 된다.

### 근거 (라이브러리 문구가 지켜야 할 것)

- 러닝 초보: 주 3회 이하, **연속일 금지**(8주간). 단일 러닝이 최근 30일 최장보다 10% 이상 길어지면 부상 위험 1.64배 → 진행은 "3~4주 같은 길이 유지 후 10% 이내 증가". 케이던스는 평소보다 5~10% 올림("180"은 근거 없음).
- 턱걸이: 데드행 → 스캐뮬러 풀 → 인버티드 로우 → 네거티브 → 밴드 → 정자세. 네거티브가 전이 가장 좋음. 실패 직전까지 가지 않는 잦은 소량 세트(GtG)가 밀도 훈련보다 최대 횟수 49% 더 늘림. 첫 정자세 1회까지 6~12주.
- 요가: 고강도 후 부교감 반동 근거 있음(회복 세션). 근육통 완화 근거는 약함 → "근육통이 낫는다"고 쓰지 말 것.
- 수영: 근력 운동과 간섭 적음 → 턱걸이 같은 날 배치 OK. 수영 선수는 뼈·힘줄 적응이 느림 → 러닝 시작 시 특히 보수적으로.
- 준비도가 낮을 때는 **건너뛰지 말고 강도를 먼저 낮춘다**. 완전 휴식은 질병 신호일 때만.

## POST /api/health

Body는 JSON. 세 가지 형태를 받는다.

1. `{ "text": "컨디션 4 3 2 3" }` — 기존 한 줄 파서(`parseLog`+`logStamp`). 응답 `{ok:true, added, kind, echo}`.
2. `{ "action": "plan", "day": "월", "items": ["수영","턱걸이"] }` — 요일 계획 교체. 내부적으로 `계획 월 수영 턱걸이` 한 줄로 저장. 응답 `{ok:true, echo}`.
3. `{ "action": "workout_log", "id": "<workouts[].id>", "rpe": 6, "note": "..." }` — 해당 세션에 sRPE 기록. 서버가 세션의 날짜·종목·분을 찾아 `sRPE <종목> <분> <rpe> <note>` 한 줄로 저장(그 날짜 타임스탬프로). 응답 `{ok:true, echo}`.

오류는 `200 {ok:false, error:"사람이 읽을 한국어 메시지"}`.

## 화면 요구 (워커 B)

**지금 화면이 볼품없다는 게 출발점이다.** 상품 수준으로 다시 만든다. 단일 HTML(인라인 CSS/JS 허용,
파일 분리도 허용). 프레임워크 금지(빌드 파이프라인 없음, `public/`은 정적 서빙). 외부 스크립트 금지 —
차트는 인라인 SVG로 직접 그린다. 폰트는 이미 쓰는 Google Fonts(Outfit + Noto Sans KR) 유지.

- **모바일 우선.** iPhone 세로. 홈 화면 앱(standalone)으로 열림, safe-area 대응.
- **다크/라이트 모두.** 기존 앱 토큰과 같은 계열: light `--bg #f7f7f5 / --card #fff / --ink #14201a / --accent #1f6f4a`,
  dark `--bg #0f1512 / --card #182019 / --ink #eef2ef / --accent #4fb083`. 강조색은 하나.
- **첫 화면에서 오늘 할 일과 준비도가 보인다.** 스크롤 전에 판단이 끝나야 한다.
- 준비도는 숫자만 던지지 말고 **원형/호 게이지 + 밴드 + 이유 3줄**, 접었다 펴면 8개 구성 항목 막대.
- **오늘의 계획 카드**: 오늘 요일 항목을 카드로. 각 항목을 탭하면 `PlanDetail`이 펼쳐진다
  (요약/목표/방법 단계/진행 규칙/주의/오늘 준비도에 따른 조정 한 줄). 여기가 "운동 계획을 자세히 설명"하는 자리.
- **운동 기록**: 최근 세션 목록. RPE 미기록 세션은 눈에 띄게(탭 → 1~10 선택 + 코멘트 → 저장).
  기록된 세션은 RPE와 코멘트를 보여준다. 상단에 **"워치에서 가져오기"** 버튼:
  `location.href = 'shortcuts://run-shortcut?name=%EA%B1%B4%EA%B0%95%20%EC%97%85%EB%A1%9C%EB%93%9C&input=text&text=force'`
  (코디네이터가 단축어 쪽 force 처리를 맡는다. B는 버튼과 안내 문구만.)
- **컨디션 4항목**: 1~5 큰 탭 타깃. 최근 14일 미니 추이(항목별). 저장하면 즉시 반영.
- **주간 캘린더**: 7칸, 계획 항목 칩. 한 것/안 한 것/휴식/미래를 색으로 구분. 지난 날 미이행은 경고색.
- **추세**: 수면·HRV·안정심박 스파크라인(최근 30일), 종목별 월간(수영 거리, 러닝 페이스), 주간 부하.
- **태그·메모**: 칩 + 한 줄. 최근 기록 표시.
- `alerts`가 있으면 상단 배너.
- 데이터가 없는 카드는 **비어 보이지 않게** 안내 문구를 넣는다(예: "러닝은 다음 주부터 — 첫 세션이 기록되면 여기 추세가 생겨요").
- 저장은 낙관적 UI 금지: 요청 성공 후 다시 `GET`으로 새로고침. 실패 시 토스트로 서버 메시지 노출.
- 접근성: 버튼은 44px 이상, 포커스 링 유지, `prefers-reduced-motion` 존중.
- **개발용**: `?fixture=1` 이면 `GET /health-fixture.json`을 대신 읽어 렌더한다(API 없이 화면 확인 가능).

## 테스트·검증

- 워커 A: `npx vitest run api/` 통과, `npx tsc --noEmit --ignoreConfig --strict --skipLibCheck --module nodenext --moduleResolution nodenext --target es2022 api/health.ts api/_plan.ts` 통과.
  `public/health-fixture.json` 과 실제 응답 모양이 같은지 검증하는 테스트를 최소 하나 추가한다.
- 워커 B: `?fixture=1` 로 렌더가 깨지지 않는지 직접 확인(브라우저 없으면 HTML/JS를 정적으로 점검).
  필수: 라이트/다크 모두, 데이터 없는 상태(빈 배열)에서도 렌더.
- 둘 다: 완료 시 `worker_done` 에 바꾼 파일과 남은 것을 적는다.
