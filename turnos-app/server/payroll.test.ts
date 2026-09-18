import { describe, expect, test } from 'vitest';
import { calculatePayroll, type Employee, type LegalRule } from './payroll.js';

const employee: Employee = {
  id: 1,
  name: 'Prueba Cocina',
  code: 'COCINA01',
  monthly_salary_cents: 175090500,
  transport_eligible: 1,
  rest_day: 7,
};
const rules: LegalRule[] = [
  {
    effective_from: '2026-07-15',
    minimum_salary_cents: 175090500,
    transport_allowance_cents: 24909500,
    weekly_hours: 42,
    night_start_hour: 19,
    rest_day_surcharge: 0.9,
  },
];

describe('calculatePayroll', () => {
  test('clasifica como extra todo lo trabajado después de 7 horas diarias', () => {
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-03T13:00:00.000Z',
          clock_out: '2026-08-03T21:00:00.000Z',
        },
      ],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(
      result.breakdown.find((x) => x.category === 'ordinary_day')?.hours,
    ).toBe(7);
    expect(
      result.breakdown.find((x) => x.category === 'overtime_day')?.hours,
    ).toBe(1);
  });

  test('acumula turnos separados del mismo día antes de iniciar las extras', () => {
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-03T13:00:00.000Z',
          clock_out: '2026-08-03T17:00:00.000Z',
        },
        {
          clock_in: '2026-08-03T18:00:00.000Z',
          clock_out: '2026-08-03T22:00:00.000Z',
        },
      ],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(
      result.breakdown.find((x) => x.category === 'ordinary_day')?.hours,
    ).toBe(7);
    expect(
      result.breakdown.find((x) => x.category === 'overtime_day')?.hours,
    ).toBe(1);
  });

  test('ya no depende de franjas semanales heredadas', () => {
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-05T13:00:00.000Z',
          clock_out: '2026-08-05T15:00:00.000Z',
        },
      ],
      rules,
      '2026-08-01',
      '2026-08-15',
      [
        {
          work_date: '2026-08-05',
          is_work_day: 0,
          scheduled_start: null,
          scheduled_end: null,
        },
      ],
    );
    expect(
      result.breakdown.find((x) => x.category === 'ordinary_day')?.hours,
    ).toBe(2);
    expect(
      result.breakdown.find((x) => x.category === 'overtime_day')?.hours,
    ).toBe(0);
  });

  test('arrastra las 42 horas trabajadas desde el lunes si el período empieza a mitad de semana', () => {
    const shifts = [
      ...['27', '28', '29', '30', '31'].map((day) => ({
        clock_in: `2026-07-${day}T13:00:00.000Z`,
        clock_out: `2026-07-${day}T20:00:00.000Z`,
      })),
      {
        clock_in: '2026-08-01T13:00:00.000Z',
        clock_out: '2026-08-01T20:00:00.000Z',
      },
      {
        clock_in: '2026-08-02T13:00:00.000Z',
        clock_out: '2026-08-02T15:00:00.000Z',
      },
    ];
    const result = calculatePayroll(
      employee,
      shifts,
      rules,
      '2026-08-02',
      '2026-08-15',
    );
    expect(result.worked_hours).toBe(2);
    expect(
      result.breakdown.find((x) => x.category === 'overtime_rest_day')?.hours,
    ).toBe(2);
  });

  test('en el descanso paga recargo las primeras 7 horas y extra desde la octava', () => {
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-02T13:00:00.000Z',
          clock_out: '2026-08-02T21:00:00.000Z',
        },
      ],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(
      result.breakdown.find((x) => x.category === 'rest_day_day')?.hours,
    ).toBe(7);
    expect(
      result.breakdown.find((x) => x.category === 'overtime_rest_day')?.hours,
    ).toBe(1);
  });

  test('incluye media mensualidad y medio auxilio en una quincena', () => {
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(result.base_salary_cents).toBe(87545250);
    expect(result.transport_cents).toBe(12454750);
    expect(result.gross_total_cents).toBe(100000000);
    expect(result.ibc_cents).toBe(87545250);
    expect(result.health_deduction_cents).toBe(3501810);
    expect(result.pension_deduction_cents).toBe(3501810);
    expect(result.total_deductions_cents).toBe(7003620);
    expect(result.net_total_cents).toBe(92996380);
  });

  test('una bonificación no salarial se paga completa y no aporta al IBC', () => {
    const sinBono = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
      [],
      [
        {
          concept: 'Buen comportamiento',
          amount_cents: 10000000,
          constitutes_salary: 0,
        },
      ],
    );
    expect(result.bonus_total_cents).toBe(10000000);
    expect(result.bonus_non_salary_cents).toBe(10000000);
    expect(result.gross_total_cents).toBe(sinBono.gross_total_cents + 10000000);
    expect(result.ibc_cents).toBe(sinBono.ibc_cents);
    expect(result.total_deductions_cents).toBe(sinBono.total_deductions_cents);
    expect(result.net_total_cents).toBe(sinBono.net_total_cents + 10000000);
    expect(result.non_salary_excess_cents).toBe(0);
  });

  test('una bonificación marcada como salarial sí aporta al IBC', () => {
    const sinBono = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
      [],
      [
        {
          concept: 'Producción',
          amount_cents: 10000000,
          constitutes_salary: 1,
        },
      ],
    );
    expect(result.bonus_salary_cents).toBe(10000000);
    expect(result.ibc_cents).toBe(sinBono.ibc_cents + 10000000);
    expect(result.total_deductions_cents).toBeGreaterThan(
      sinBono.total_deductions_cents,
    );
    expect(result.net_total_cents).toBe(
      result.gross_total_cents - result.total_deductions_cents,
    );
  });

  test('lleva al IBC el exceso no salarial sobre el 40% del total', () => {
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
      [],
      [
        {
          concept: 'Premio anual',
          amount_cents: 100000000,
          constitutes_salary: 0,
        },
      ],
    );
    // 100.000.000 frente a una remuneración de 187.545.250: el tope del 40% es
    // 75.018.100 y el exceso de 24.981.900 sí cotiza.
    expect(result.non_salary_excess_cents).toBe(24981900);
    expect(result.ibc_cents).toBe(112527150);
    expect(result.gross_total_cents).toBe(200000000);
    expect(result.net_total_cents).toBe(
      result.gross_total_cents - result.total_deductions_cents,
    );
  });

  test('suma varias bonificaciones de conceptos distintos', () => {
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
      [],
      [
        {
          concept: 'Buen comportamiento',
          amount_cents: 5000000,
          constitutes_salary: 0,
        },
        { concept: 'Domicilios', amount_cents: 3000000, constitutes_salary: 0 },
        {
          concept: 'Cumplimiento',
          amount_cents: 2000000,
          constitutes_salary: 1,
        },
      ],
    );
    expect(result.bonuses).toHaveLength(3);
    expect(result.bonus_total_cents).toBe(10000000);
    expect(result.bonus_salary_cents).toBe(2000000);
    expect(result.bonus_non_salary_cents).toBe(8000000);
  });

  test('excluye el auxilio de transporte del IBC', () => {
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(result.ibc_cents).toBe(result.base_salary_cents);
    expect(result.deductions.find((x) => x.category === 'health')?.rate).toBe(
      0.04,
    );
  });

  test('el salario base siempre es el mínimo aunque el registro heredado diga otro valor', () => {
    const highIncomeEmployee = {
      ...employee,
      monthly_salary_cents: rules[0].minimum_salary_cents * 4,
      transport_eligible: 0,
    };
    const result = calculatePayroll(
      highIncomeEmployee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(result.base_salary_cents).toBe(rules[0].minimum_salary_cents / 2);
    expect(
      result.deductions.find((x) => x.category === 'solidarity')?.rate,
    ).toBe(0);
  });

  test('resta deducciones manuales sin modificar el IBC ni el total devengado', () => {
    const sinDeduccion = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
      [],
      [],
      undefined,
      [
        { id: 1, concept: 'Adelanto', amount_cents: 5000000 },
        { id: 2, concept: 'Deuda comedor', amount_cents: 2000000 },
      ],
    );
    expect(result.manual_deductions).toHaveLength(2);
    expect(result.manual_deduction_total_cents).toBe(7000000);
    expect(result.gross_total_cents).toBe(sinDeduccion.gross_total_cents);
    expect(result.ibc_cents).toBe(sinDeduccion.ibc_cents);
    expect(result.total_deductions_cents).toBe(
      sinDeduccion.total_deductions_cents + 7000000,
    );
    expect(result.net_total_cents).toBe(sinDeduccion.net_total_cents - 7000000);
  });

  test('aplica solidaridad según el IBC real del mes completo', () => {
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
      [],
      [],
      {
        ibc_cents: rules[0].minimum_salary_cents * 4,
        salary_earnings_cents: rules[0].minimum_salary_cents * 4,
      },
    );
    expect(
      result.deductions.find((x) => x.category === 'solidarity')?.rate,
    ).toBe(0.01);
  });

  test('parte exactamente el día y la noche a las 19:00 incluyendo segundos', () => {
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-03T23:59:30.000Z',
          clock_out: '2026-08-04T00:00:30.000Z',
        },
      ],
      rules,
      '2026-08-01',
      '2026-08-15',
      [
        {
          work_date: '2026-08-03',
          is_work_day: 1,
          is_rest_day: 0,
          scheduled_start: '18:00',
          scheduled_end: '20:00',
        },
      ],
    );
    expect(
      result.breakdown.find((x) => x.category === 'ordinary_day')?.minutes,
    ).toBe(0.5);
    expect(
      result.breakdown.find((x) => x.category === 'ordinary_night')?.minutes,
    ).toBe(0.5);
  });

  test('en una jornada de 10 horas liquida 7 ordinarias y 3 extras', () => {
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-03T12:00:00.000Z',
          clock_out: '2026-08-03T22:00:00.000Z',
        },
      ],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(
      result.breakdown.find((x) => x.category === 'ordinary_day')?.hours,
    ).toBe(7);
    expect(
      result.breakdown.find((x) => x.category === 'overtime_day')?.hours,
    ).toBe(3);
  });

  test('respeta el descanso semanal recurrente elegido por el trabajador', () => {
    const tuesdayRestEmployee = { ...employee, rest_day: 2 };
    const result = calculatePayroll(
      tuesdayRestEmployee,
      [
        {
          clock_in: '2026-08-04T13:00:00.000Z',
          clock_out: '2026-08-04T14:00:00.000Z',
        },
        {
          clock_in: '2026-08-09T13:00:00.000Z',
          clock_out: '2026-08-09T14:00:00.000Z',
        },
      ],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(
      result.breakdown.find((x) => x.category === 'rest_day_day')?.hours,
    ).toBe(1);
    expect(
      result.breakdown.find((x) => x.category === 'ordinary_day')?.hours,
    ).toBe(1);
  });

  test('un festivo conserva el recargo aunque no sea el descanso semanal', () => {
    const schedules = [
      {
        work_date: '2026-08-17',
        is_work_day: 1,
        is_rest_day: 0,
        scheduled_start: '08:00',
        scheduled_end: '09:00',
      },
    ];
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-17T13:00:00.000Z',
          clock_out: '2026-08-17T14:00:00.000Z',
        },
      ],
      rules,
      '2026-08-16',
      '2026-08-31',
      schedules,
    );
    expect(
      result.breakdown.find((x) => x.category === 'rest_day_day')?.hours,
    ).toBe(1);
  });

  test('no duplica dinero cuando recibe intervalos solapados', () => {
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-03T13:00:00.000Z',
          clock_out: '2026-08-03T15:00:00.000Z',
        },
        {
          clock_in: '2026-08-03T14:00:00.000Z',
          clock_out: '2026-08-03T16:00:00.000Z',
        },
      ],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(result.worked_hours).toBe(3);
  });

  test('advierte sin dejar de pagar cuando se exceden límites de extras', () => {
    const shifts = Array.from({ length: 5 }, (_, index) => ({
      clock_in: `2026-08-${String(index + 3).padStart(2, '0')}T13:00:00.000Z`,
      clock_out: `2026-08-${String(index + 3).padStart(2, '0')}T23:00:00.000Z`,
    }));
    const result = calculatePayroll(
      employee,
      shifts,
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    expect(
      result.breakdown
        .filter((x) => x.category.startsWith('overtime'))
        .reduce((sum, x) => sum + x.hours, 0),
    ).toBe(20);
    expect(
      result.compliance_alerts.filter((x) => x.code === 'DAILY_OVERTIME_LIMIT'),
    ).toHaveLength(5);
    expect(
      result.compliance_alerts.filter(
        (x) => x.code === 'WEEKLY_OVERTIME_LIMIT',
      ),
    ).toHaveLength(1);
  });

  test('retira auxilio si el ingreso salarial mensual supera dos mínimos', () => {
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
      [],
      [],
      {
        ibc_cents: rules[0].minimum_salary_cents * 2.1,
        salary_earnings_cents: rules[0].minimum_salary_cents * 2.1,
      },
    );
    expect(result.transport_cents).toBe(0);
  });

  test('no permite que una regla configurada rebaje los mínimos legales vigentes', () => {
    const unsafeRules = [
      {
        ...rules[0],
        weekly_hours: 48,
        night_start_hour: 21,
        rest_day_surcharge: 0.75,
      },
    ];
    const schedules = [
      {
        work_date: '2026-08-09',
        is_work_day: 1,
        is_rest_day: 1,
        scheduled_start: '19:00',
        scheduled_end: '20:00',
      },
    ];
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-10T00:00:00.000Z',
          clock_out: '2026-08-10T01:00:00.000Z',
        },
      ],
      unsafeRules,
      '2026-08-01',
      '2026-08-15',
      schedules,
    );
    const line = result.breakdown.find((x) => x.category === 'rest_day_night')!;
    expect(line.hours).toBe(1);
    expect(line.rate_multiplier).toBe(1.25);
  });

  test('a las 06:00 termina exactamente el recargo nocturno', () => {
    const result = calculatePayroll(
      employee,
      [
        {
          clock_in: '2026-08-03T10:59:30.000Z',
          clock_out: '2026-08-03T11:00:30.000Z',
        },
      ],
      rules,
      '2026-08-01',
      '2026-08-15',
      [
        {
          work_date: '2026-08-03',
          is_work_day: 1,
          is_rest_day: 0,
          scheduled_start: '05:00',
          scheduled_end: '07:00',
        },
      ],
    );
    expect(
      result.breakdown.find((x) => x.category === 'ordinary_night')?.minutes,
    ).toBe(0.5);
    expect(
      result.breakdown.find((x) => x.category === 'ordinary_day')?.minutes,
    ).toBe(0.5);
  });

  test('usa factores legales para todas las categorías de recargo en 2026', () => {
    const expected = {
      ordinary_night: 0.35,
      overtime_day: 1.25,
      overtime_night: 1.75,
      rest_day_day: 0.9,
      rest_day_night: 1.25,
      overtime_rest_day: 2.15,
      overtime_rest_night: 2.65,
    };
    const result = calculatePayroll(
      employee,
      [],
      rules,
      '2026-08-01',
      '2026-08-15',
    );
    for (const [category, multiplier] of Object.entries(expected))
      expect(
        result.breakdown.find((x) => x.category === category)?.rate_multiplier,
      ).toBe(multiplier);
  });
});
