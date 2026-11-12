/**
 * Inabadilisha namba ya simu ya Tanzania kuwa muundo mmoja: +2557XXXXXXXX / +2556XXXXXXXX.
 * Inakubali: 0712345678, 712345678, 255712345678, +255 712 345 678.
 * Inarudisha null kama namba si sahihi.
 */
export function normalizeTzPhone(input: string | undefined | null): string | null {
  if (!input) return null;
  let d = input.replace(/\D/g, '');
  if (d.startsWith('255')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  if (!/^[67]\d{8}$/.test(d)) return null;
  return `+255${d}`;
}
