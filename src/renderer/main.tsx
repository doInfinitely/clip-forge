import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

console.log('[renderer] main.tsx loaded')
createRoot(document.getElementById('root')!).render(<App />)
