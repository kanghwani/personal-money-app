import type { VercelRequest, VercelResponse } from '@vercel/node'

const KIS_BASE = 'https://openapi.koreainvestment.com:9443'

// 인메모리 토큰 캐시 (Vercel 함수는 재사용될 수 있음)
let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token
  }

  const appKey = process.env.KIS_APP_KEY
  const appSecret = process.env.KIS_APP_SECRET

  if (!appKey || !appSecret) {
    throw new Error('KIS_APP_KEY / KIS_APP_SECRET 환경 변수가 설정되지 않았습니다.')
  }

  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`KIS 토큰 발급 실패: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: data.access_token,
    // expires_in은 초 단위 (보통 86400 = 24시간)
    expiresAt: now + data.expires_in * 1000,
  }
  return cachedToken.token
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 헤더 (GitHub Pages or localhost 허용)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const code = req.query.code as string | undefined
  if (!code) {
    return res.status(400).json({ error: '종목 코드(code)가 필요합니다. 예: ?code=005930' })
  }

  try {
    const token = await getAccessToken()
    const appKey = process.env.KIS_APP_KEY!
    const appSecret = process.env.KIS_APP_SECRET!

    // 주식 현재가 조회 (국내 주식)
    const priceRes = await fetch(
      `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`,
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${token}`,
          appkey: appKey,
          appsecret: appSecret,
          tr_id: 'FHKST01010100',
        },
      }
    )

    if (!priceRes.ok) {
      const text = await priceRes.text()
      return res.status(502).json({ error: `KIS 현재가 조회 실패: ${priceRes.status}`, detail: text })
    }

    const data = (await priceRes.json()) as {
      output?: {
        stck_prpr: string   // 주식 현재가
        prdy_vrss: string   // 전일 대비
        prdy_ctrt: string   // 전일 대비율
        hts_kor_isnm: string // 종목명
      }
      rt_cd: string
      msg1: string
    }

    if (data.rt_cd !== '0') {
      return res.status(400).json({ error: data.msg1 })
    }

    const output = data.output!
    return res.status(200).json({
      code,
      name: output.hts_kor_isnm,
      price: Number(output.stck_prpr),
      change: Number(output.prdy_vrss),
      changeRate: Number(output.prdy_ctrt) / 100,
      updatedAt: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: message })
  }
}
