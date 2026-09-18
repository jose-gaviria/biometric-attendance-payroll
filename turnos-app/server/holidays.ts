import { DateTime } from 'luxon';

function easterSunday(year: number): DateTime {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return DateTime.local(year, month, day);
}

function nextMonday(date: DateTime): DateTime {
  return date.plus({ days: (8 - date.weekday) % 7 });
}

export function colombianHolidays(year: number): Set<string> {
  const iso = (date: DateTime) => date.toISODate()!;
  const dates = new Set<string>();
  const fixed = [
    [1, 1],
    [5, 1],
    [7, 20],
    [8, 7],
    [12, 8],
    [12, 25],
  ];
  const mondayized = [
    [1, 6],
    [3, 19],
    [6, 29],
    [8, 15],
    [10, 12],
    [11, 1],
    [11, 11],
  ];
  fixed.forEach(([month, day]) =>
    dates.add(iso(DateTime.local(year, month, day))),
  );
  mondayized.forEach(([month, day]) =>
    dates.add(iso(nextMonday(DateTime.local(year, month, day)))),
  );
  const easter = easterSunday(year);
  dates.add(iso(easter.minus({ days: 3 })));
  dates.add(iso(easter.minus({ days: 2 })));
  dates.add(iso(nextMonday(easter.plus({ days: 39 }))));
  dates.add(iso(nextMonday(easter.plus({ days: 60 }))));
  dates.add(iso(nextMonday(easter.plus({ days: 68 }))));
  return dates;
}
