import { useEffect, useState } from 'react';
import { Cloud, House, LayoutGrid, SlidersHorizontal } from 'lucide-react';
import { CatalogSettings } from './CatalogSettings';
import { DashboardSettings } from './DashboardSettings';
import { AccessSettings } from './AccessSettings';
import { ReleaseDestinationsSettings } from './ReleaseDestinationsSettings';
import { useFinance, type SettingsTab } from '../../stores/financeStore';
import { ActionBtn } from '../ui/Icon';

function resolveSettingsTab(tab?: SettingsTab): 'catalogos' | 'hoy' | 'acceso' | 'control' {
  if (tab === 'hoy') return 'hoy';
  if (tab === 'acceso' || tab === 'drive') return 'acceso';
  if (tab === 'control') return 'control';
  return 'catalogos';
}

export function SettingsScreen({ tab: initialTab }: { tab?: SettingsTab }) {
  const go = useFinance((state) => state.go);
  const [tab, setTab] = useState<'catalogos' | 'hoy' | 'acceso' | 'control'>(resolveSettingsTab(initialTab));

  useEffect(() => {
    setTab(resolveSettingsTab(initialTab));
  }, [initialTab]);

  const openTab = (next: 'catalogos' | 'hoy' | 'acceso' | 'control') => {
    setTab(next);
    go({ name: 'settings', tab: next });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <ActionBtn
          icon={LayoutGrid}
          label="Catálogos"
          title="Cuentas, fondos, tarjetas y partidas. No registra un movimiento."
          variant={tab === 'catalogos' ? 'primary' : 'secondary'}
          onClick={() => openTab('catalogos')}
        />
        <ActionBtn
          icon={SlidersHorizontal}
          label="Control"
          title="Cuentas que reciben el dinero al liberar un apartado. No es un gasto."
          variant={tab === 'control' ? 'primary' : 'secondary'}
          onClick={() => openTab('control')}
        />
        <ActionBtn
          icon={House}
          label="Inicio"
          title="Qué cuentas y slots se muestran en Inicio."
          variant={tab === 'hoy' ? 'primary' : 'secondary'}
          onClick={() => openTab('hoy')}
        />
        <ActionBtn
          icon={Cloud}
          label="Acceso"
          title="Google Drive: subir el libro, copias fechadas y restaurar."
          variant={tab === 'acceso' ? 'primary' : 'secondary'}
          onClick={() => openTab('acceso')}
        />
      </div>

      {tab === 'catalogos' && <CatalogSettings />}
      {tab === 'control' && <ReleaseDestinationsSettings />}
      {tab === 'hoy' && <DashboardSettings />}
      {tab === 'acceso' && <AccessSettings />}
    </div>
  );
}
