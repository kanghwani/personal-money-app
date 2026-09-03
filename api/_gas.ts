/** GAS 웹앱 호출 공용 (mcp.ts·today.ts). 환경변수 SYNC_URL, SYNC_TOKEN — 서버 전용. */
const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} 환경변수가 없습니다`)
  return v
}

/** GAS는 가끔 302/404를 뱉어서 재시도한다. */
export async function gasGet<T = unknown>(action: string, extra = ''): Promise<T> {
  const url = `${env('SYNC_URL')}?action=${action}&token=${encodeURIComponent(env('SYNC_TOKEN'))}${extra}`
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (r.ok) return await r.json() as T
    } catch { /* 재시도 */ }
    await new Promise((s) => setTimeout(s, 1500))
  }
  throw new Error('가계부 서버 응답 실패 (잠시 후 다시)')
}

export async function gasPost(body: Record<string, unknown>): Promise<unknown> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(env('SYNC_URL'), {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...body, token: env('SYNC_TOKEN') }),
      })
      if (r.ok) return await r.json()
    } catch { /* 재시도 */ }
    await new Promise((s) => setTimeout(s, 1500))
  }
  throw new Error('가계부 저장 실패 (잠시 후 다시)')
}

