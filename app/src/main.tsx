import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PwaRoot } from './app/PwaRoot.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaRoot />
  </StrictMode>,
)
