// Ponte com o app Android do Krata (quando o site roda dentro dele).
export interface KrataNativeBridge {
  version(): string
  startScreen(quality: string, fps: number, audio: boolean): void
  stopScreen(): void
  screenState(): string
  setInCall(on: boolean): void
  speak?(text: string, rate: number, pitch: number, volume: number): void
  stopSpeaking?(): void
  isSpeaking?(): boolean
  // notificações (app 1.1+)
  setInbox?(json: string): void
  clearInbox?(): void
  notify?(json: string): void
  clearChannel?(channelId: string): void
  appVisible?(): boolean
  notificationsAllowed?(): boolean
  requestNotifications?(): void
  backgroundAllowed?(): boolean
  openBackgroundSettings?(): void
  setLiveSync?(on: boolean): void
}
declare global { interface Window { KrataNative?: KrataNativeBridge } }

export const APK_URL = '/krata.apk'
export const APP_VERSION = '1.1.0'
export const isApp = () => typeof window !== 'undefined' && (!!window.KrataNative || /KrataApp\//.test(navigator.userAgent))
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
export const isIOSDevice = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
