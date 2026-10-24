// Intl formatters are relatively expensive to construct, so cache them per
// locale + option set. Two languages means this stays tiny.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(locale: string, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${options ? JSON.stringify(options) : ''}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Full dates use YYYY-MM-DD; partial dates and time formats keep their requested options. */
export function formatDateValue(value: string | number | Date, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(typeof value === 'string' ? value.replace(' ', 'T') : value);
  if (Number.isNaN(date.getTime())) return '';
  const fullDate = !options || (options.year && options.month && options.day && !options.hour && !options.timeStyle);
  if (!fullDate) return getDateFormatter(locale, options).format(date);
  const parts = getDateFormatter(locale, { ...options, year: 'numeric', month: '2-digit', day: '2-digit',
    calendar: 'gregory', numberingSystem: 'latn' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value ?? '').join('-');
}

