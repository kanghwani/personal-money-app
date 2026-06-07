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
