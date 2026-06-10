export type LearnedRule = { keyword: string; category: string; subCategory: string }

const LEARNED_RULES_KEY = 'shiba-learned-rules:v1'

/** keyword(trim, 대소문자 무시)로 upsert. 일치하면 갱신, 없으면 맨 앞에 추가. 빈 keyword/category는 무시. */
export function upsertRule(rules: LearnedRule[], rule: LearnedRule): LearnedRule[] {
  const keyword = (rule.keyword || '').trim()
  if (!keyword || !rule.category) return rules
  const norm = keyword.toLowerCase()
  const rest = rules.filter((r) => r.keyword.trim().toLowerCase() !== norm)
  return [{ keyword, category: rule.category, subCategory: rule.subCategory || '' }, ...rest]
}

/** 메모가 학습 keyword를 포함하면 그 카테고리 반환. 더 긴(구체적) keyword를 우선. 없으면 null. */
export function classifyByLearned(
  memo: string,
  rules: LearnedRule[],
): { category: string; subCategory: string } | null {
  const text = (memo || '').toLowerCase()
  if (!text) return null
  const sorted = [...rules].sort((a, b) => b.keyword.length - a.keyword.length)
  for (const r of sorted) {
    const kw = r.keyword.trim().toLowerCase()
    if (kw && text.includes(kw)) return { category: r.category, subCategory: r.subCategory || '' }
  }
  return null
}

/** localStorage에서 학습 규칙 읽기(실패 시 빈 배열). */
export function loadLearnedRules(): LearnedRule[] {
  try {
    const raw = window.localStorage.getItem(LEARNED_RULES_KEY)
    return raw ? (JSON.parse(raw) as LearnedRule[]) : []
  } catch {
    return []
  }
}

/** 규칙 1건 학습(load → upsert → 저장). 실패는 무시. */
export function saveLearnedRule(rule: LearnedRule): void {
  try {
    const next = upsertRule(loadLearnedRules(), rule)
    window.localStorage.setItem(LEARNED_RULES_KEY, JSON.stringify(next))
  } catch {
    /* 용량 초과 등 무시 */
  }
}
