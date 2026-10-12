// Treina o cérebro da Prisma fora da página, para não travar a tela (principalmente no celular).
import { Brain } from './brain'
import type { Intent } from './dataset'

self.onmessage = async (e: MessageEvent<{ extra: { text: string; intent: Intent }[] }>) => {
  const brain = new Brain()
  await brain.train(e.data.extra)
  const w = brain.weights()
  ;(self as unknown as Worker).postMessage(w, [w.W.buffer, w.b.buffer, w.idf.buffer])
}
