/** 영어 단수 · 복수: plural(1, 'file') → '1 file', plural(3, 'file') → '3 files' */
export function plural(n: number | string, one: string, many = `${one}s`): string {
  const count = Number(n);
  return `${n} ${count === 1 ? one : many}`;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
