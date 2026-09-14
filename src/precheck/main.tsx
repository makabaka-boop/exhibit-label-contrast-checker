import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PrecheckApp from './PrecheckApp';
import '../styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrecheckApp />
  </StrictMode>,
);
