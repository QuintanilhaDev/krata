// Voz → texto com o Whisper da Groq (usado no "toque para falar", principalmente no iPhone).
// POST /api/prisma-stt  corpo: o áudio gravado (webm, mp4, ogg ou wav), até 4 MB
import { GROQ_BASE, authUser, env, json } from './_lib.js'

export async function POST(request: Request) {
  if (!env('GROQ_API_KEY')) return json(503, { error: 'not_configured' })
  const user = await authUser(request)
  if (!user) return json(401, { error: 'login' })
  const type = request.headers.get('content-type') || 'audio/webm'
  const audio = await request.arrayBuffer()
  if (audio.byteLength < 800) return json(200, { text: '' })
  if (audio.byteLength > 4 * 1024 * 1024) return json(413, { error: 'too_large' })
  const ext = /mp4|m4a|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : /wav/.test(type) ? 'wav' : 'webm'
  const form = new FormData()
  form.append('file', new Blob([audio], { type }), `fala.${ext}`)
  form.append('model', env('PRISMA_STT_MODEL') || 'whisper-large-v3-turbo')
  form.append('language', 'pt')
  form.append('temperature', '0')
  // ajuda o reconhecimento a acertar o nome dela e termos do app
  form.append('prompt', 'Prisma, Krata, servidor, canal, call, compartilhar tela, pedido de amizade.')
  form.append('response_format', 'json')
  const r = await fetch(`${GROQ_BASE()}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${env('GROQ_API_KEY')}` }, body: form })
  if (r.status === 429) return json(429, { error: 'limit' })
  if (!r.ok) return json(502, { error: 'stt', detail: (await r.text()).slice(0, 300) })
  const d = (await r.json()) as { text?: string }
  return json(200, { text: (d.text || '').trim() })
}
