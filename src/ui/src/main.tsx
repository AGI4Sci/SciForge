import React from 'react';
import { createRoot } from 'react-dom/client';
import { SciForgeApp } from './App';
import { AppErrorBoundary } from './app/AppErrorBoundary';
import './styles/base.css';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <SciForgeApp />
    </AppErrorBoundary>
  </React.StrictMode>,
);
