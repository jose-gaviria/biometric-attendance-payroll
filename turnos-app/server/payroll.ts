import { DateTime } from 'luxon';
import { colombianHolidays } from './holidays.js';

export const TIME_ZONE = 'America/Bogota';

export type Employee = {
  id: number;
  name: string;
  code: string;
  monthly_salary_cents: number;
  transport_eligible: number;
  rest_day: number;
};

export type Shift = { clock_in: string; clock_out: string | null };
export type Bonus = {
  id?: number;
  concept: string;
  amount_cents: number;
  // Una bonificación ocasional del jefe es mera liberalidad y no constituye
  // salario (art. 128 CST); marcarla como salarial la lleva al IBC.
  constitutes_salary: number;
};
export type ManualDeduction = {
  id?: number;
  concept: string;
  amount_cents: number;
};
export type WeeklyScheduleDay = {
  work_date: string;
  is_work_day: number;
  is_rest_day?: number;
  scheduled_start: string | null;
  scheduled_end: string | null;
};
export type LegalRule = {
  effective_from: string;
  minimum_salary_cents: number;
  transport_allowance_cents: number;
  weekly_hours: number;
  night_start_hour: number;
  rest_day_surcharge: number;
};

export const categoryMeta = {
  ordinary_day: { label: 'Horas ordinarias diurnas', multiplier: 0 },
  ordinary_night: { label: 'Recargo nocturno ordinario', multiplier: 0.35 },
  overtime_day: { label: 'Extras diurnas', multiplier: 1.25 },
  overtime_night: { label: 'Extras nocturnas', multiplier: 1.75 },
  rest_day_day: { label: 'Dominical/festiva diurna', multiplier: 'rest' },
  rest_day_night: {
    label: 'Dominical/festiva nocturna',
    multiplier: 'restNight',
  },
  overtime_rest_day: {
    label: 'Extra dominical/festiva diurna',
    multiplier: 'overtimeRest',
  },
  overtime_rest_night: {
    label: 'Extra dominical/festiva nocturna',
    multiplier: 'overtimeRestNight',
  },
} as const;

export type Category = keyof typeof categoryMeta;
export type BreakdownLine = {
  category: Category;
  label: string;
  minutes: number;
  hours: number;
  amount_cents: number;
  rate_multiplier: number;
};
export type DeductionLine = {
  category: 'health' | 'pension' | 'solidarity' | 'manual';
  label: string;
  rate: number;
  amount_cents: number;
};

function ruleFor(date: DateTime, rules: LegalRule[]): LegalRule {
  const key = date.toISODate()!;
  return (
    [...rules].reverse().find((rule) => rule.effective_from <= key) ?? rules[0]
  );
}

const DAILY_ORDINARY_MINUTES = 7 * 60;

function isRestDay(date: DateTime, employee: Employee) {
  return date.weekday === employee.rest_day;
}

function multiplierFor(category: Category, rule: LegalRule): number {
  const value = categoryMeta[category].multiplier;
  if (typeof value === 'number') return value;
  if (value === 'rest') return rule.rest_day_surcharge;
  if (value === 'restNight') return rule.rest_day_surcharge + 0.35;
  if (value === 'overtimeRest') return 1 + rule.rest_day_surcharge + 0.25;
  return 1 + rule.rest_day_surcharge + 0.75;
}

function statutoryWeeklyMaximum(date: DateTime) {
  if (date >= DateTime.fromISO('2026-07-15', { zone: TIME_ZONE })) return 42;
  if (date >= DateTime.fromISO('2025-07-15', { zone: TIME_ZONE })) return 44;
  if (date >= DateTime.fromISO('2024-07-15', { zone: TIME_ZONE })) return 46;
  return 47;
}

function effectiveRule(date: DateTime, rules: LegalRule[]): LegalRule {
  const configured = ruleFor(date, rules);
  const restFloor =
    date >= DateTime.fromISO('2027-07-01', { zone: TIME_ZONE })
      ? 1
      : date >= DateTime.fromISO('2026-07-01', { zone: TIME_ZONE })
        ? 0.9
        : date >= DateTime.fromISO('2025-07-01', { zone: TIME_ZONE })
          ? 0.8
          : 0.75;
  return {
    ...configured,
    weekly_hours: Math.min(
      configured.weekly_hours,
      statutoryWeeklyMaximum(date),
    ),
    night_start_hour:
      date >= DateTime.fromISO('2025-12-25', { zone: TIME_ZONE })
        ? Math.min(configured.night_start_hour, 19)
        : configured.night_start_hour,
    rest_day_surcharge: Math.max(configured.rest_day_surcharge, restFloor),
  };
}

function solidarityRate(monthlyIbcCents: number, minimumSalaryCents: number) {
  const minimumSalaries = monthlyIbcCents / minimumSalaryCents;
  if (minimumSalaries < 4) return 0;
  if (minimumSalaries >= 20) return 0.02;
  if (minimumSalaries >= 19) return 0.018;
  if (minimumSalaries >= 18) return 0.016;
  if (minimumSalaries >= 17) return 0.014;
  if (minimumSalaries >= 16) return 0.012;
  return 0.01;
}

export function calculatePayroll(
  employee: Employee,
  shifts: Shift[],
  rules: LegalRule[],
  startDate: string,
  endDate: string,
  _schedules: WeeklyScheduleDay[] = [],
  bonuses: Bonus[] = [],
  monthlyContext?: { ibc_cents: number; salary_earnings_cents: number },
  manualDeductions: ManualDeduction[] = [],
) {
  const start = DateTime.fromISO(startDate, { zone: TIME_ZONE }).startOf('day');
  const end = DateTime.fromISO(endDate, { zone: TIME_ZONE }).endOf('day');
  // Una quincena puede comenzar a mitad de una semana. Para decidir cuándo se
  // supera el máximo semanal hay que contar también lo trabajado desde el
  // lunes anterior, aunque esos minutos no se vuelvan a pagar en este período.
  const classificationStart = start.startOf('week');
  const minutesByCategory = Object.fromEntries(
    Object.keys(categoryMeta).map((key) => [key, 0]),
  ) as Record<Category, number>;
  const amountsByCategory = Object.fromEntries(
    Object.keys(categoryMeta).map((key) => [key, 0]),
  ) as Record<Category, number>;
  const workedByWeek = new Map<string, number>();
  const ordinaryByDate = new Map<string, number>();
  const overtimeByDate = new Map<string, number>();
  const overtimeByWeek = new Map<string, number>();
  const holidaysByYear = new Map<number, Set<string>>();
  let workedMinutes = 0;
  const workedDates = new Set<string>();
  // Unir intervalos solapados evita pagar dos veces el mismo tiempo aunque
  // una importación histórica haya eludido las validaciones de la interfaz.
  const intervals = shifts
    .filter((shift): shift is Shift & { clock_out: string } =>
      Boolean(shift.clock_out),
    )
    .map((shift) => ({
      start: DateTime.fromISO(shift.clock_in, { zone: 'utc' }).setZone(
        TIME_ZONE,
      ),
      end: DateTime.fromISO(shift.clock_out, { zone: 'utc' }).setZone(
        TIME_ZONE,
      ),
    }))
    .filter(
      (interval) =>
        interval.start.isValid &&
        interval.end.isValid &&
        interval.end > interval.start,
    )
    .sort((a, b) => a.start.toMillis() - b.start.toMillis())
    .reduce<Array<{ start: DateTime; end: DateTime }>>((merged, interval) => {
      const previous = merged.at(-1);
      if (previous && interval.start <= previous.end) {
        if (interval.end > previous.end) previous.end = interval.end;
      } else merged.push(interval);
      return merged;
    }, []);

  for (const interval of intervals) {
    let cursor =
      interval.start < classificationStart
        ? classificationStart
        : interval.start;
    const clippedEnd =
      interval.end > end ? end.plus({ millisecond: 1 }) : interval.end;
    while (cursor < clippedEnd) {
      const rule = effectiveRule(cursor, rules);
      const holidaySet =
        holidaysByYear.get(cursor.year) ?? colombianHolidays(cursor.year);
      holidaysByYear.set(cursor.year, holidaySet);
      const dateKey = cursor.toISODate()!;
      const restDay = isRestDay(cursor, employee) || holidaySet.has(dateKey);
      const night = cursor.hour >= rule.night_start_hour || cursor.hour < 6;
      const weekKey = `${cursor.weekYear}-${cursor.weekNumber}`;
      const usedWeekly = workedByWeek.get(weekKey) ?? 0;
      const usedDaily = ordinaryByDate.get(dateKey) ?? 0;
      const overtime =
        usedWeekly >= rule.weekly_hours * 60 ||
        usedDaily >= DAILY_ORDINARY_MINUTES;
      const nextMinute = cursor.startOf('minute').plus({ minute: 1 });
      let quantum = Math.min(
        clippedEnd.diff(cursor, 'minutes').minutes,
        nextMinute.diff(cursor, 'minutes').minutes,
      );
      if (!overtime) {
        quantum = Math.min(
          quantum,
          rule.weekly_hours * 60 - usedWeekly,
          DAILY_ORDINARY_MINUTES - usedDaily,
        );
      }
      if (quantum <= 0) continue;
      workedByWeek.set(weekKey, usedWeekly + quantum);
      if (!overtime) ordinaryByDate.set(dateKey, usedDaily + quantum);

      // Los minutos previos al inicio de la liquidación solo aportan contexto
      // al límite semanal; su valor pertenece al período anterior.
      if (cursor < start) {
        cursor = cursor.plus({ minutes: quantum });
        continue;
      }

      let category: Category;
      if (overtime && restDay)
        category = night ? 'overtime_rest_night' : 'overtime_rest_day';
      else if (overtime) category = night ? 'overtime_night' : 'overtime_day';
      else if (restDay) category = night ? 'rest_day_night' : 'rest_day_day';
      else category = night ? 'ordinary_night' : 'ordinary_day';

      // Todos los trabajadores de esta instalación devengan el SMLMV. El
      // divisor mensual es horas semanales x 5 (42 x 5 = 210 desde 2026-07-15).
      const divisor = rule.weekly_hours * 5;
      const hourlyRate = rule.minimum_salary_cents / divisor;
      minutesByCategory[category] += quantum;
      amountsByCategory[category] +=
        (hourlyRate * multiplierFor(category, rule) * quantum) / 60;
      workedMinutes += quantum;
      workedDates.add(cursor.toISODate()!);
      if (overtime) {
        overtimeByDate.set(
          dateKey,
          (overtimeByDate.get(dateKey) ?? 0) + quantum,
        );
        overtimeByWeek.set(
          weekKey,
          (overtimeByWeek.get(weekKey) ?? 0) + quantum,
        );
      }
      cursor = cursor.plus({ minutes: quantum });
    }
  }

  const periodRule = effectiveRule(end, rules);
  const fullCalendarMonth =
    start.day === 1 &&
    end.day === end.endOf('month').day &&
    start.hasSame(end, 'month');
  const periodFraction = fullCalendarMonth ? 1 : 0.5;
  const baseSalaryCents = Math.round(
    periodRule.minimum_salary_cents * periodFraction,
  );
  const breakdown: BreakdownLine[] = (
    Object.keys(categoryMeta) as Category[]
  ).map((category) => ({
    category,
    label: categoryMeta[category].label,
    minutes: Math.round(minutesByCategory[category] * 100) / 100,
    hours: Math.round((minutesByCategory[category] / 60) * 100) / 100,
    amount_cents: Math.round(amountsByCategory[category]),
    rate_multiplier: multiplierFor(category, periodRule),
  }));
  const extrasCents = breakdown.reduce(
    (sum, line) => sum + line.amount_cents,
    0,
  );
  const calculatedDays =
    Math.floor(end.startOf('day').diff(start, 'days').days) + 1;
  const bonusLines = bonuses.map((bonus) => ({
    id: bonus.id,
    concept: bonus.concept,
    amount_cents: bonus.amount_cents,
    constitutes_salary: Number(bonus.constitutes_salary) === 1,
  }));
  const bonusSalaryCents = bonusLines
    .filter((line) => line.constitutes_salary)
    .reduce((sum, line) => sum + line.amount_cents, 0);
  const bonusNonSalaryCents = bonusLines
    .filter((line) => !line.constitutes_salary)
    .reduce((sum, line) => sum + line.amount_cents, 0);
  const bonusTotalCents = bonusSalaryCents + bonusNonSalaryCents;
  const salaryEarningsCents = baseSalaryCents + extrasCents + bonusSalaryCents;
  const estimatedMonthlySalaryEarnings = fullCalendarMonth
    ? salaryEarningsCents
    : periodRule.minimum_salary_cents + extrasCents + bonusSalaryCents;
  const transportCents =
    employee.transport_eligible &&
    (monthlyContext?.salary_earnings_cents ?? estimatedMonthlySalaryEarnings) <=
      periodRule.minimum_salary_cents * 2
      ? Math.round(periodRule.transport_allowance_cents * periodFraction)
      : 0;
  const grossTotalCents =
    baseSalaryCents + transportCents + extrasCents + bonusTotalCents;
  const periodIbcCap = Math.round(
    periodRule.minimum_salary_cents * 25 * periodFraction,
  );
  // Ley 1393 de 2010, art. 30: lo pactado como no salarial solo puede quedar
  // fuera del IBC hasta el 40% del total; el exceso sí cotiza.
  const remunerationCents =
    baseSalaryCents + extrasCents + bonusSalaryCents + bonusNonSalaryCents;
  const nonSalaryLimitCents = Math.round(remunerationCents * 0.4);
  const nonSalaryExcessCents = Math.max(
    0,
    bonusNonSalaryCents - nonSalaryLimitCents,
  );
  const ibcCents = Math.min(
    baseSalaryCents + extrasCents + bonusSalaryCents + nonSalaryExcessCents,
    periodIbcCap,
  );
  const monthlyIbcProjection =
    monthlyContext?.ibc_cents ??
    (fullCalendarMonth
      ? ibcCents
      : periodRule.minimum_salary_cents +
        extrasCents +
        bonusSalaryCents +
        nonSalaryExcessCents);
  const solidarity = solidarityRate(
    monthlyIbcProjection,
    periodRule.minimum_salary_cents,
  );
  const deductions: DeductionLine[] = [
    {
      category: 'health',
      label: 'Salud',
      rate: 0.04,
      amount_cents: Math.round(ibcCents * 0.04),
    },
    {
      category: 'pension',
      label: 'Fondo de pensión',
      rate: 0.04,
      amount_cents: Math.round(ibcCents * 0.04),
    },
    {
      category: 'solidarity',
      label: 'Fondo de Solidaridad Pensional',
      rate: solidarity,
      amount_cents: Math.round(ibcCents * solidarity),
    },
  ];
  const manualDeductionLines = manualDeductions.map((deduction) => ({
    id: deduction.id,
    category: 'manual' as const,
    label: deduction.concept,
    rate: 0,
    amount_cents: deduction.amount_cents,
  }));
  deductions.push(...manualDeductionLines);
  const totalDeductionsCents = deductions.reduce(
    (sum, line) => sum + line.amount_cents,
    0,
  );
  const netTotalCents = grossTotalCents - totalDeductionsCents;
  const complianceAlerts = [
    ...[...overtimeByDate.entries()]
      .filter(([, minutes]) => minutes > 2 * 60)
      .map(([date, minutes]) => ({
        code: 'DAILY_OVERTIME_LIMIT',
        label: 'Límite diario de horas extra excedido',
        detail: `${date}: ${Math.round((minutes / 60) * 100) / 100} horas extra; el máximo legal es 2.`,
      })),
    ...[...overtimeByWeek.entries()]
      .filter(([, minutes]) => minutes > 12 * 60)
      .map(([week, minutes]) => ({
        code: 'WEEKLY_OVERTIME_LIMIT',
        label: 'Límite semanal de horas extra excedido',
        detail: `Semana ${week}: ${Math.round((minutes / 60) * 100) / 100} horas extra; el máximo legal es 12.`,
      })),
  ];
  return {
    employee_id: employee.id,
    employee_name: employee.name,
    employee_code: employee.code,
    start_date: startDate,
    end_date: endDate,
    worked_minutes: workedMinutes,
    worked_hours: Math.round((workedMinutes / 60) * 100) / 100,
    worked_days: workedDates.size,
    calculated_days: calculatedDays,
    base_salary_cents: baseSalaryCents,
    transport_cents: transportCents,
    extras_cents: extrasCents,
    bonuses: bonusLines,
    bonus_total_cents: bonusTotalCents,
    bonus_salary_cents: bonusSalaryCents,
    bonus_non_salary_cents: bonusNonSalaryCents,
    manual_deductions: manualDeductionLines,
    manual_deduction_total_cents: manualDeductionLines.reduce(
      (sum, line) => sum + line.amount_cents,
      0,
    ),
    non_salary_excess_cents: nonSalaryExcessCents,
    ibc_cents: ibcCents,
    gross_total_cents: grossTotalCents,
    salary_earnings_cents: salaryEarningsCents,
    health_deduction_cents: deductions[0].amount_cents,
    pension_deduction_cents: deductions[1].amount_cents,
    solidarity_deduction_cents: deductions[2].amount_cents,
    total_deductions_cents: totalDeductionsCents,
    net_total_cents: netTotalCents,
    total_cents: netTotalCents,
    compliance_alerts: complianceAlerts,
    breakdown,
    deductions,
  };
}
