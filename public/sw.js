// Krata — service worker das notificações no computador.
// Recebe os avisos (Web Push) mesmo com a aba fechada e mostra uma notificação bonita:
// foto redonda de quem mandou (com anel jade), as últimas mensagens da conversa juntas,
// foto anexada em destaque e botões "Responder" e "Marcar como lida".
const CFG = '/__krata-sw-config'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// ------------------------------------------------------------------ configuração vinda do site
async function getConfig() {
  try {
    const c = await caches.open('krata-sw')
    const r = await c.match(CFG)
    return r ? await r.json() : null
  } catch { return null }
}
async function setConfig(cfg) {
  const c = await caches.open('krata-sw')
  if (cfg) await c.put(CFG, new Response(JSON.stringify(cfg), { headers: { 'content-type': 'application/json' } }))
  else await c.delete(CFG)
}

self.addEventListener('message', (e) => {
  const d = e.data || {}
  if (d.type === 'config') e.waitUntil(setConfig(d.config || null))
  if (d.type === 'show') e.waitUntil(present(d.payload || {}, true))
})

// ------------------------------------------------------------------ foto redonda
const b64 = (buf) => {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
async function roundAvatar(url, name, color) {
  if (typeof OffscreenCanvas === 'undefined') return url || '/icon-192.png'
  try {
    const size = 192
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext('2d')
    let img = null
    if (url) {
      try {
        const r = await fetch(url, { mode: 'cors', credentials: 'omit' })
        if (r.ok) img = await createImageBitmap(await r.blob())
      } catch { img = null }
    }
    // anel jade com brilho
    const ring = ctx.createLinearGradient(0, 0, size, size)
    ring.addColorStop(0, '#5BE3B4'); ring.addColorStop(1, '#00A86B')
    ctx.fillStyle = ring
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#0b0f0e'
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 7, 0, Math.PI * 2); ctx.fill()
    ctx.save()
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2); ctx.clip()
    if (img) {
      const s = Math.min(img.width, img.height)
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 12, 12, size - 24, size - 24)
    } else {
      const g = ctx.createLinearGradient(0, 0, size, size)
      g.addColorStop(0, color || '#00A86B'); g.addColorStop(1, '#0b3d2c')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#fff'
      ctx.font = '700 86px "Segoe UI", Roboto, Arial, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(((name || 'K').trim()[0] || 'K').toUpperCase(), size / 2, size / 2 + 4)
    }
    ctx.restore()
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return `data:image/png;base64,${b64(await blob.arrayBuffer())}`
  } catch { return url || '/icon-192.png' }
}

// ------------------------------------------------------------------ mostrar
const SEP = ' · '
async function present(p, force) {
  const tag = `krata-${p.ch || 'geral'}`
  // mensagens anteriores da mesma conversa ficam juntas na mesma notificação
  let lines = []
  try {
    const old = await self.registration.getNotifications({ tag })
    for (const n of old) { lines = (n.data && n.data.lines) || []; n.close() }
  } catch { /* sem histórico */ }
  const solo = p.k === 'dm'
  lines = [...lines, solo ? p.b : `${p.who}: ${p.b}`].slice(-5)
  const count = lines.length
  const title = count > 1 ? `${p.t}${SEP}${count} mensagens` : p.t
  const body = count > 1 ? lines.join('\n') : (p.k === 'reply' ? `↩ Respondeu você: ${p.b}` : p.b)
  const icon = await roundAvatar(p.au, p.who, p.ac)
  const opts = {
    body: body || 'Nova mensagem',
    icon,
    badge: '/badge-96.png',
    tag,
    renotify: true,
    timestamp: p.ts || Date.now(),
    data: { ch: p.ch, sv: p.sv, lines, url: p.sv ? `/#/s/${p.sv}/${p.ch}` : `/#/@me/${p.ch}` },
    actions: [{ action: 'reply', title: 'Responder' }, { action: 'read', title: 'Marcar como lida' }],
  }
  if (p.img) opts.image = p.img
  if (!force) {
    // alguém está usando o Krata agora nesta máquina: o próprio app avisa (som + contador)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (wins.some((w) => w.focused && w.visibilityState === 'visible')) return
  }
  await self.registration.showNotification(title, opts)
}

self.addEventListener('push', (e) => {
  let p = {}
  try { p = e.data ? e.data.json() : {} } catch { p = { t: 'Krata', b: e.data ? e.data.text() : 'Nova mensagem' } }
  e.waitUntil(present(p, false))
})

// ------------------------------------------------------------------ clique
async function markRead(ch) {
  const cfg = await getConfig()
  if (!cfg || !cfg.secret || !ch) return
  try {
    await fetch(`${cfg.url}/rest/v1/rpc/device_mark_read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: cfg.key, ...(String(cfg.key).startsWith('eyJ') ? { authorization: `Bearer ${cfg.key}` } : {}) },
      body: JSON.stringify({ p_secret: cfg.secret, p_channel: ch }),
    })
  } catch { /* sem rede */ }
}

async function openChat(data, reply) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const win = wins.find((w) => new URL(w.url).origin === self.location.origin)
  if (win) {
    await win.focus()
    win.postMessage({ type: 'krata-open', ch: data.ch, sv: data.sv || null, reply: !!reply })
    return
  }
  await self.clients.openWindow(data.url || '/')
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification
  const data = n.data || {}
  n.close()
  if (e.action === 'read') e.waitUntil(markRead(data.ch))
  else e.waitUntil(openChat(data, e.action === 'reply'))
})
