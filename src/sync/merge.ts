export type Snapshot<T> = { store: T; updatedAt: string }

/** updatedAt(ISO) 비교로 더 최신 스냅샷을 반환한다. 동률·무효는 local 우선. */
export function pickNewer<T>(local: Snapshot<T>, remote: Snapshot<T> | null): Snapshot<T> {
  if (!remote) return local
  const l = Date.parse(local.updatedAt)
  const r = Date.parse(remote.updatedAt)
  if (Number.isNaN(r)) return local
  if (Number.isNaN(l)) return remote
  return r > l ? remote : local
}
