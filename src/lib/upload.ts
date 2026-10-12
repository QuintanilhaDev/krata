import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase'
import type { Attachment } from './types'

export const MAX_FILE_BYTES = 200 * 1024 * 1024
export const MAX_FILES = 10
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024

const safeName = (name: string) =>
  name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_.]+/, '').slice(-80) || 'arquivo'

function mediaSize(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const done = (v: { width?: number; height?: number }) => { URL.revokeObjectURL(url); resolve(v) }
    const url = URL.createObjectURL(file)
    const timer = setTimeout(() => done({}), 4000)
    if (file.type.startsWith('image/')) {
      const img = new Image()
      img.onload = () => { clearTimeout(timer); done({ width: img.naturalWidth, height: img.naturalHeight }) }
      img.onerror = () => { clearTimeout(timer); done({}) }
      img.src = url
    } else if (file.type.startsWith('video/')) {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => { clearTimeout(timer); done({ width: v.videoWidth || undefined, height: v.videoHeight || undefined }) }
      v.onerror = () => { clearTimeout(timer); done({}) }
      v.src = url
    } else { clearTimeout(timer); done({}) }
  })
}

export interface UploadHandle { promise: Promise<string>; abort: () => void }

/** Envia um arquivo para o Storage com barra de progresso. Retorna a URL pública. */
export function uploadFile(bucket: 'attachments' | 'avatars', userId: string, file: File, onProgress?: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest()
  const path = `${userId}/${crypto.randomUUID()}/${safeName(file.name)}`
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const promise = (async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Sua sessão expirou. Entre de novo.')
    return await new Promise<string>((resolve, reject) => {
      xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${encoded}`)
      xhr.setRequestHeader('authorization', `Bearer ${token}`)
      xhr.setRequestHeader('apikey', SUPABASE_KEY)
      xhr.setRequestHeader('x-upsert', 'false')
      xhr.setRequestHeader('cache-control', 'max-age=31536000')
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
      xhr.onload = () => {
        let body: { statusCode?: string; message?: string; error?: string } = {}
        try { body = JSON.parse(xhr.responseText) } catch { /* resposta vazia */ }
        const code = String(body.statusCode || xhr.status)
        if (xhr.status >= 200 && xhr.status < 300) return resolve(`${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encoded}`)
        if (code === '413' || /maximum allowed size|too large/i.test(body.message || ''))
          return reject(new Error(`"${file.name}" passa do limite de envio do servidor. No Supabase, aumente o limite global de upload (Storage → Settings).`))
        if (code === '403' || code === '401') return reject(new Error('O servidor recusou o envio. Entre de novo e tente outra vez.'))
        reject(new Error(body.message || `Falha ao enviar "${file.name}".`))
      }
      xhr.onerror = () => reject(new Error(`A conexão caiu ao enviar "${file.name}".`))
      xhr.onabort = () => reject(new DOMException('Envio cancelado', 'AbortError'))
      xhr.send(file)
    })
  })()
  return { promise, abort: () => xhr.abort() }
}

export async function describeFile(file: File, url: string): Promise<Attachment> {
  const dim = await mediaSize(file)
  return { url, name: file.name.slice(0, 200), size: file.size, type: file.type || 'application/octet-stream', ...dim }
}
