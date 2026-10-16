import '@fontsource-variable/onest'
import '@fontsource/unbounded/600.css'
import '@fontsource/unbounded/800.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyPerf } from './lib/perf'
import { watchFreshness } from './lib/freshness'
import './styles/app.css'

applyPerf()
watchFreshness()
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
