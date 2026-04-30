import React from 'react';
import { createRoot } from 'react-dom/client';
import { BioAgentApp } from './App';
import './styles/base.css';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BioAgentApp />
  </React.StrictMode>,
);
