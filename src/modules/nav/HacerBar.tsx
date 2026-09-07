import { ArrowLeftRight, CreditCard, Landmark, PiggyBank, Receipt, Sparkles } from 'lucide-react';
import { PRODUCT_NAME } from '../../branding';
import { useFinance, type Screen } from '../../stores/financeStore';
import { ChipBtn } from '../ui/Icon';
import { hacerActionActive, type HacerAction } from './nav';

export function HacerBar({
  screen,
  peopleLabel,
  linkedEmail,
}: {
  screen: Screen;
  peopleLabel: string;
  linkedEmail: string | null;
}) {
  const go = useFinance((state) => state.go);

  const actions: Array<HacerAction & { icon: typeof Receipt }> = [
    {
      id: 'gastar',
      label: 'Gastar',
      hint: 'Registrar un gasto: elige medio (Barras, ONE, Gastos X o bolsillo), cobertura y persona.',
      icon: Receipt,
      screen: { name: 'move', intent: 'GASTAR' },
    },
    {
      id: 'mover',
      label: 'Mover',
      hint: 'Liberar capital a otra cuenta o mover entre Ahorros y Ahorros 2. No es un gasto.',
      icon: ArrowLeftRight,
      screen: { name: 'move', intent: 'TRANSFERENCIA' },
    },
    {
      id: 'aporte',
      label: 'Aporte',
      hint: 'Abonar dinero de Z o A a una cuenta de ahorro. No es un gasto.',
      icon: PiggyBank,
      screen: { name: 'move', intent: 'APORTE' },
    },
    {
      id: 'fondos',
      label: 'Fondos',
      hint: 'Recargar lo quincenal o vaciar varios fondos. No es gasto.',
      icon: Landmark,
      screen: { name: 'move', intent: 'FONDOS' },
    },
    {
      id: 'proyectos',
      label: 'Proyectos',
      hint: 'Metas, sueños y plan de préstamos. No es un fondo presupuestado.',
      icon: Sparkles,
      screen: { name: 'projects' },
    },
    {
      id: 'tarjeta',
      label: 'Tarjeta',
      hint: 'Pagar ONE solo desde Atlántida. Baja el debe de la tarjeta y el apartado de Atlántida.',
      icon: CreditCard,
      screen: { name: 'move', intent: 'PAGO_TARJETA' },
    },
  ];

  return (
    <header className="space-y-3">
      <p className="text-xs uppercase tracking-[0.25em] text-duty/80">
        {PRODUCT_NAME} · {peopleLabel}
        {linkedEmail ? ` · ${linkedEmail}` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <ChipBtn
            key={action.id}
            icon={action.icon}
            label={action.label}
            title={action.hint}
            active={hacerActionActive(screen, action)}
            onClick={() => go(action.screen)}
          />
        ))}
      </div>
    </header>
  );
}
