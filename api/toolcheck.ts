import type { VercelRequest, VercelResponse } from '@vercel/node'
import { TOOLS } from './mcp.js'

/**
 * 배포된 서버가 실제로 어떤 툴 스키마를 서빙하는지 확인하는 통로.
 *
 * 소스 기반 테스트는 "코드가 맞는가"만 본다. 배포가 아직 안 왔거나 옛 번들이 남아 있으면
 * 테스트는 전부 통과하는데 클라이언트는 옛 스키마를 받는 구간이 생긴다. 그 구간을 닫는다.
 * 인증은 /api/today 와 같은 SYNC_TOKEN 을 쓴다(툴 목록 외에 아무것도 노출하지 않는다).
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if ((req.query.t as string) !== process.env.SYNC_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' })
  return res.status(200).json({
    ok: true,
    count: TOOLS.length,
    tools: TOOLS.map((t) => ({
      name: t.name,
      properties: Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}).sort(),
      required: ((t.inputSchema as { required?: string[] }).required ?? []).slice().sort(),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  })
}
