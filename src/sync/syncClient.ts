export type SyncConfig = { url: string; token: string }

export type RemoteSnapshot<T> = { store: T; updatedAt: string }

/** 환경변수에서 동기화 설정을 읽는다. 둘 중 하나라도 비면 null(동기화 비활성). */
export function getSyncConfig(): SyncConfig | null {
  const url = import.meta.env.VITE_SYNC_URL
  const token = import.meta.env.VITE_SYNC_TOKEN
  if (!url || !token) return null
  return { url, token }
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
  const url = `${cfg.url}?action=load&token=${encodeURIComponent(cfg.token)}`
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
    }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}
