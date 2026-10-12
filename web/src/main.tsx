import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { RELEASE } from './lib/constants';

// Public release build only: set the skin and wait for its stylesheet so the first paint is already skinned.
// The evaluator build never sets the attribute and never loads cyber.css.
if (RELEASE) {
  document.documentElement.dataset.skin = 'cyber';
  // The public site follows the OS until the visitor picks a mode: apply it before first paint (index.html only knows 'dark').
  try {
    if (!localStorage.getItem('aq-theme') && matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
  } catch { /* storage blocked: next-themes settles it after mount */ }
  await import('./release/cyber.css');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
