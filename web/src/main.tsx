import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { RELEASE } from './lib/constants';

// The public site follows the OS until the visitor picks a mode: apply it before first paint (index.html only knows 'dark').
if (RELEASE) {
  try {
    if (!localStorage.getItem('aq-theme') && matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
  } catch { /* storage blocked: next-themes settles it after mount */ }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
