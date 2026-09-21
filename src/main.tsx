import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// No StrictMode — WebContainer.boot() must run only once per page
createRoot(document.getElementById('root')!).render(<App />)
