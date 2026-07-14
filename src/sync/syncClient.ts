import type { FixedDef } from '../dashboardLogic'
import { PROFILE } from '../classifyRules'

export type SyncConfig = { url: string; token: string; profile: string }

export type RemoteSnapshot<T> = { store: T; updatedAt: string }

/** 환경변수에서 동기화 설정을 읽는다. 둘 중 하나라도 비면 null(동기화 비활성). */
export function getSyncConfig(): SyncConfig | null {
  const url = import.meta.env.VITE_SYNC_URL
  const token = import.meta.env.VITE_SYNC_TOKEN
  if (!url || !token) return null
  // VITE_PROFILE을 독립적으로 다시 읽지 않고 classifyRules의 단일 출처를 그대로 사용(F5:
  // VITE_PROFILE만 빠지거나 오타가 나도 LANG과 profile이 항상 함께 ko로 fail-closed됨)
  return { url, token, profile: PROFILE }
}

/** profile이 있으면 &profile=... 반환, 없으면 빈 문자열. */
function profileQuery(cfg: SyncConfig): string {
  return cfg.profile ? `&profile=${encodeURIComponent(cfg.profile)}` : ''
}

/**
 * 서버에서 스냅샷을 읽는다.
 * - cfg가 없으면(동기화 비활성) null
 * - 서버에 데이터가 없으면(ok지만 store가 빈 값) null  ← "업로드 필요" 신호
 * - 네트워크/파싱 오류는 throw한다 (호출부가 catch해서 offline 처리; null로 삼키면 "서버 비어있음"과 구분 불가).
 */
export async function loadFromServer<T>(
  cfg: SyncConfig | null = getSyncConfig(),
): Promise<RemoteSnapshot<T> | null> {
  if (!cfg) return null
  const url = `${cfg.url}?action=load&token=${encodeURIComponent(cfg.token)}${profileQuery(cfg)}`
  const res = await fetch(url, { method: 'GET', redirect: 'follow' })
  const data = await res.json()
  if (!data || !data.ok || !data.store) return null
  return { store: JSON.parse(data.store) as T, updatedAt: String(data.updatedAt || '') }
}

/**
 * 스냅샷을 서버에 저장한다. cfg가 없으면 false.
 * 네트워크/파싱 오류는 throw한다 (호출부가 catch해서 offline 처리).
 */
export async function saveToServer<T>(
  store: T,
  updatedAt: string,
  cfg: SyncConfig | null = getSyncConfig(),
): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    redirect: 'follow',
    body: JSON.stringify({
      action: 'save',
      token: cfg.token,
      store: JSON.stringify(store),
      updatedAt,
      profile: cfg.profile,
    }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}

/**
 * 시트 원장(과거 거래 전체)을 읽어온다.
 * - cfg 없으면(비활성) [] 반환
 * - ok가 아니거나 transactions 배열이 없으면 []
 * - 네트워크/파싱 오류는 throw (호출부가 catch해서 [] 처리)
 */
export async function loadLedger<T>(
  cfg: SyncConfig | null = getSyncConfig(),
): Promise<T[]> {
  if (!cfg) return []
  const url = `${cfg.url}?action=ledger&token=${encodeURIComponent(cfg.token)}${profileQuery(cfg)}`
  const res = await fetch(url, { method: 'GET', redirect: 'follow' })
  const data = await res.json()
  if (!data || !data.ok || !Array.isArray(data.transactions)) return []
  return data.transactions as T[]
}

/** 거래 카테고리를 서버(시트 원장)에 반영하고 분류규칙을 학습시킨다. cfg 없으면 false. */
export async function assignCategory(
  id: string,
  category: string,
  subCategory: string,
  memo: string = '',
  cfg: SyncConfig | null = getSyncConfig(),
): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    redirect: 'follow',
    body: JSON.stringify({ action: 'assignCategory', token: cfg.token, id, category, subCategory, memo, profile: cfg.profile }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}

export async function loadFixedDefs(cfg: SyncConfig | null = getSyncConfig()): Promise<FixedDef[]> {
  if (!cfg) return []
  const res = await fetch(`${cfg.url}?action=fixedList&token=${encodeURIComponent(cfg.token)}${profileQuery(cfg)}`, { redirect: 'follow' })
  const data = await res.json()
  return data && data.ok && Array.isArray(data.defs) ? data.defs : []
}

export async function saveFixedDef(def: FixedDef, cfg: SyncConfig | null = getSyncConfig()): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ action: 'fixedSave', token: cfg.token, def, profile: cfg.profile }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}

export async function deleteFixedDef(id: string, cfg: SyncConfig | null = getSyncConfig()): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ action: 'fixedDelete', token: cfg.token, id, profile: cfg.profile }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}

/** 거래원장에서 id로 행 삭제. 원장에 없으면(로컬 전용) 서버는 ok/deleted:0 반환. cfg 없으면 false. */
export async function deleteLedger(id: string, cfg: SyncConfig | null = getSyncConfig()): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ action: 'deleteLedger', token: cfg.token, id, profile: cfg.profile }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}

/** 거래원장 행을 id로 찾아 전체 필드 갱신(금액/날짜/내역/분류/결제수단/고정변동/분담금). cfg 없으면 false. */
export async function updateLedger(tx: unknown, cfg: SyncConfig | null = getSyncConfig()): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ action: 'updateLedger', token: cfg.token, tx, profile: cfg.profile }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}

/** 앱 거래를 거래원장에 추가(앱 id 그대로 사용, 같은 id 있으면 서버가 스킵). cfg 없으면 false. */
export async function appendLedger(tx: unknown, cfg: SyncConfig | null = getSyncConfig()): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ action: 'appendLedger', token: cfg.token, tx, profile: cfg.profile }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}
