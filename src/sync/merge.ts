export type Snapshot<T> = { store: T; updatedAt: string }

/**
 * 두 스냅샷 중 우선할 것을 반환한다 (last-write-wins by updatedAt ISO).
 * - remote가 null이거나 remote.updatedAt가 무효면 local
 * - local.updatedAt가 무효이고 remote가 유효하면 remote (유효한 서버 타임스탬프 우선)
 * - 그 외에는 updatedAt가 더 큰 쪽, 동률이면 local
 */
export function pickNewer<T>(local: Snapshot<T>, remote: Snapshot<T> | null): Snapshot<T> {
  if (!remote) return local
  const l = Date.parse(local.updatedAt)
  const r = Date.parse(remote.updatedAt)
  if (Number.isNaN(r)) return local
  if (Number.isNaN(l)) return remote
  return r > l ? remote : local
}

/** history와 store 거래를 id 기준으로 병합한다. 같은 id는 store가 우선(최신). */
export function dedupById<T extends { id: string }>(history: T[], store: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of history) map.set(item.id, item)
  for (const item of store) map.set(item.id, item)
  return [...map.values()]
}

/**
 * 원격 스냅샷을 받아들일 때, 아직 원장에 못 올린 로컬 거래를 함께 살린다.
 *
 * store.transactions 는 두 가지를 겸한다: 사용자 데이터이자 "원장 append 대기열"이다.
 * 그런데 pickNewer 는 store 전체를 통째로 바꾸므로, 다른 기기가 더 최신이면
 * 이 기기에서 방금 입력해 아직 못 보낸 거래가 그대로 사라졌다.
 * 대기열은 원장에 들어가는 순간 지워지므로, id 기준으로 남겨두는 것이 항상 안전하다.
 */
export function keepPending<T extends { id: string }>(
  localTx: T[], remoteTx: T[], ledgerKeys: Set<string>, keyOf: (t: T) => string = (t) => t.id,
): T[] {
  const known = new Set(remoteTx.map((t) => t.id))
  // 원장 대조는 id 가 아니라 내용으로 한다. 원장에서 고쳐 저장하면 id 가 바뀌므로,
  // id 만 보면 이미 있는 거래를 '아직 못 보낸 것'으로 오해해 되살린다.
  const pending = localTx.filter((t) => !known.has(t.id) && !ledgerKeys.has(keyOf(t)))
  return pending.length ? [...pending, ...remoteTx] : remoteTx
}
