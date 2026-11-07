import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Events from './Events.tsx'   // ponytail: 라우터 없이 경로 하나만 분기. 페이지가 늘면 그때 라우터

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/events' ? <Events /> : <App />}
  </StrictMode>,
)
