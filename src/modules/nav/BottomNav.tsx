import { House, Receipt, Settings } from 'lucide-react';
import type { Screen } from '../../stores/financeStore';
import { NavIconBtn } from '../ui/Icon';
import { bottomTabFor } from './nav';

export function BottomNav({
  screen,
  onGo,
}: {
  screen: Screen;
  onGo: (screen: Screen) => void;
}) {
  const tab = bottomTabFor(screen);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-duty/10 bg-cream/95 backdrop-blur">
      <div className="app-bottom-nav mx-auto grid max-w-3xl grid-cols-3 gap-1 px-2 pt-1">
        <NavIconBtn
          icon={House}
          label="Inicio"
          title="Saldos, prioridades y KPIs del día."
          active={tab === 'home'}
          onClick={() => onGo({ name: 'dashboard', panel: 'hoy' })}
        />
        <NavIconBtn
          icon={Receipt}
          label="Gastos"
          title="Lista de gastos. Un toque."
          active={tab === 'movements'}
          onClick={() => onGo({ name: 'movements', list: 'gastos' })}
        />
        <NavIconBtn
          icon={Settings}
          label="Ajustes"
          title="Catálogos, Inicio y Drive."
          active={tab === 'settings'}
          onClick={() => onGo({ name: 'settings', tab: 'catalogos' })}
        />
      </div>
    </nav>
  );
}
