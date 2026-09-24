const rtf = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 10) return '방금 전';
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(ts);
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function dayLabel(ts: number): string {
  const today = new Date();
  const d = new Date(ts);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (days === 0) return '오늘';
  if (days === 1) return '어제';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}
