export type Lang = 'ko' | 'es'
export const LANG: Lang = import.meta.env.VITE_LANG === 'es' ? 'es' : 'ko'

export type CatRule = { words: string[]; category: string; sub: string }
export type RuleSet = {
  categoryRules: CatRule[]
  payments: string[]              // extractPayment 후보(긴 것 먼저)
  paymentAlias: Record<string, string>  // normalizePayment 별칭
  yesterday: string
  today: string
  incomeRe: RegExp                // 수입 키워드
  uncategorized: string           // 미분류 라벨
  incomeCategory: string          // 수입 강제 분류 시 대분류
}

const ko: RuleSet = {
  categoryRules: [
    { words: ['점심', '저녁', '밥', '식당', '라멘', '피자', '버거', '김밥', '마라탕'], category: '식비', sub: '외식' },
    { words: ['커피', '카페', '아메리카노', '라떼', '스타벅스', '투썸', '이디야', '빽다방', '컴포즈', '메가커피'], category: '식비', sub: '카페' },
    { words: ['마트', '장보기', '식자재', '쿠팡', '컬리', '코스트코', '홈플러스', '롯데마트', '이마트', '노브랜드', '와마트'], category: '식비', sub: '장보기' },
    { words: ['편의점', 'CU', 'GS25', '세븐일레븐'], category: '식비', sub: '간편식' },
    { words: ['다이소'], category: '생활', sub: '생활잡화' },
    { words: ['올리브영'], category: '생활', sub: '뷰티/미용' },
    { words: ['월세', '관리비', '전기', '가스', '인터넷', '통신'], category: '주거/통신', sub: '고정비' },
    { words: ['주차', '택시', '버스', '지하철', '자동차', '기름'], category: '교통/차량', sub: '이동' },
    { words: ['병원', '약', '수영', '헬스', '운동'], category: '건강', sub: '관리' },
    { words: ['넷플릭스', '구독', '애플', '네이버', '스포티파이'], category: '문화/구독', sub: '구독' },
    { words: ['게임', '스팀', '플레이', '취미'], category: '취미', sub: '게임' },
    { words: ['유니클로'], category: '쇼핑', sub: '의류' },
    { words: ['책', '강의', '학원', '공부', '교보문고'], category: '자기계발', sub: '교육' },
    { words: ['월급', '급여', '입금', '보너스'], category: '수입', sub: '급여' },
  ],
  payments: ['국민카드','삼성카드','현대카드','신한카드','하나카드','이음카드','우리카드','롯데카드','카카오뱅크','토스뱅크','네이버페이','카카오페이','계좌이체','체크카드','토스','국민','삼성','현대','신한','카카오','네이버','현금','계좌','이음','카드'],
  // 기존 App.tsx normalizePayment의 aliases와 완전히 동일(토스 키는 원본에 없으므로 추가하지 않음 — ko 회귀 방지)
  paymentAlias: { 국민: '국민카드', 삼성: '삼성카드', 현대: '현대카드', 신한: '신한카드', 카카오: '카카오페이', 네이버: '네이버페이', 계좌: '계좌이체', 이음: '이음카드', 카드: '카드' },
  yesterday: '어제',
  today: '오늘',
  incomeRe: /수입|월급|급여|입금|보너스/,
  uncategorized: '미분류',
  incomeCategory: '수입',
}

const es: RuleSet = {
  categoryRules: [
    { words: ['café', 'cafetería', 'cafe', 'starbucks'], category: 'Comida', sub: 'Cafetería' },
    { words: ['supermercado', 'mercado', 'mercadona', 'carrefour', 'costco'], category: 'Comida', sub: 'Supermercado' },
    { words: ['restaurante', 'comida', 'almuerzo', 'cena', 'pizza', 'hamburguesa'], category: 'Comida', sub: 'Restaurante' },
    { words: ['tienda', 'conveniencia'], category: 'Vida', sub: 'Varios' },
    { words: ['alquiler', 'renta', 'luz', 'gas', 'internet', 'teléfono'], category: 'Vivienda', sub: 'Fijos' },
    { words: ['taxi', 'bus', 'metro', 'gasolina', 'coche', 'transporte'], category: 'Transporte', sub: 'Movilidad' },
    { words: ['farmacia', 'médico', 'hospital', 'gimnasio'], category: 'Salud', sub: 'Cuidado' },
    { words: ['netflix', 'suscripción', 'spotify', 'apple'], category: 'Ocio', sub: 'Suscripción' },
    { words: ['juego', 'steam', 'videojuego'], category: 'Ocio', sub: 'Juegos' },
    { words: ['ropa', 'zapatos', 'zara', 'uniqlo'], category: 'Compras', sub: 'Ropa' },
    { words: ['libro', 'curso', 'academia'], category: 'Desarrollo', sub: 'Educación' },
    { words: ['salario', 'nómina', 'sueldo', 'ingreso'], category: 'Ingreso', sub: 'Salario' },
  ],
  payments: ['tarjeta', 'efectivo', 'transferencia', 'débito', 'crédito'],
  paymentAlias: { débito: 'Tarjeta', crédito: 'Tarjeta', tarjeta: 'Tarjeta', efectivo: 'Efectivo', transferencia: 'Transferencia' },
  yesterday: 'ayer',
  today: 'hoy',
  incomeRe: /salario|nómina|sueldo|ingreso/i,
  uncategorized: 'Sin categoría',
  incomeCategory: 'Ingreso',
}

export const RULES: Record<Lang, RuleSet> = { ko, es }

/** 메모를 규칙셋으로 분류. 대소문자 무시. 미매칭이면 uncategorized. */
export function classifyMemo(memo: string, rules: RuleSet): { category: string; sub: string } {
  const lower = memo.toLowerCase()
  const hit = rules.categoryRules.find((r) => r.words.some((w) => lower.includes(w.toLowerCase())))
  return hit ? { category: hit.category, sub: hit.sub } : { category: rules.uncategorized, sub: '' }
}
