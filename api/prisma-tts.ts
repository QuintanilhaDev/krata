// Texto → voz com a voz neural da Microsoft (opcional: só funciona com AZURE_SPEECH_KEY e AZURE_SPEECH_REGION).
// Sem essas variáveis, o app usa a voz do próprio aparelho.
// POST /api/prisma-tts  { text }  → áudio mp3
import { authUser, env, json } from './_lib.js'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export async function POST(request: Request) {
  const key = env('AZURE_SPEECH_KEY'), region = env('AZURE_SPEECH_REGION')
  if (!key || !region) return json(404, { error: 'not_configured' })
  const user = await authUser(request)
  if (!user) return json(401, { error: 'login' })
  let text = ''
  try { text = String(((await request.json()) as { text?: string }).text || '').slice(0, 700) } catch { return json(400, { error: 'json' }) }
  if (!text.trim()) return json(400, { error: 'empty' })
  const voice = env('PRISMA_VOICE') || 'pt-BR-ThalitaMultilingualNeural'
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR"><voice name="${esc(voice)}"><prosody rate="+6%" pitch="+4%">${esc(text)}</prosody></voice></speak>`
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'krata' },
    body: ssml,
  })
  if (!r.ok) return json(502, { error: 'tts', status: r.status })
  return new Response(await r.arrayBuffer(), { status: 200, headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } })
}
