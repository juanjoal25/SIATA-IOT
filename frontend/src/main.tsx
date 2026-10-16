import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registrarServiceWorker } from './lib/pwa';
import './styles.css';

const contenedor = document.getElementById('root');
if (!contenedor) throw new Error('Falta el nodo #root en index.html');

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registrarServiceWorker();
