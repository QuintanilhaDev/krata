// Assina o .apk (esquemas v1, v2 e v3) com a chave do Krata. Uso: node sign.mjs entrada.apk saida.apk chave.pem cert.pem
import { readFileSync, writeFileSync } from 'node:fs'
const { ApkSigner, SigningKey } = await import(process.env.SIGNER || 'apk_sign_ts')
const [inp, out, key, cert] = process.argv.slice(2)
const signer = new ApkSigner({ signingKey: SigningKey.fromPEM(readFileSync(key, 'utf8'), readFileSync(cert, 'utf8')), digestAlgorithm: 'SHA-256' })
const { signedApk } = await signer.sign(new Uint8Array(readFileSync(inp)))
writeFileSync(out, signedApk)
console.log('assinado:', out, signedApk.length, 'bytes')
