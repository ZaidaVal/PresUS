import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { PRODUCT_NAME } from './branding';
import { initLocalDatabase } from './database/client';
import { useFinance } from './stores/financeStore';

document.title = PRODUCT_NAME;

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  try {
    useFinance.getState().setSqliteStatus('Abriendo archivo SQLite local…');
    const ledger = await initLocalDatabase();
    await useFinance.getState().setLedger(ledger);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useFinance.getState().setError(message);
  }
}

void boot();
