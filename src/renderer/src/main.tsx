import React from 'react'
import ReactDOM from 'react-dom/client'
// Bundled typefaces for the grimoire UI (referenced via the --font-* theme tokens).
// Variable builds where available; Spectral is static so only the used cuts ship.
import '@fontsource-variable/fraunces'
import '@fontsource-variable/outfit'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/spectral/400.css'
import '@fontsource/spectral/400-italic.css'
import '@fontsource/spectral/500.css'
import './styles.css'
import { App } from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
