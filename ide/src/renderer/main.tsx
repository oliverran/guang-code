import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

// Surface uncaught errors to the main-process terminal so we can debug a blank page.
window.addEventListener('error', (e) => {
  console.error('[renderer error]', e.error?.stack || e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer unhandledrejection]', e.reason?.stack || e.reason);
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
