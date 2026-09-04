/** Money is handled in integer cents everywhere. Never float-add USD. */
export const toCents = (usd) => Math.round(Number(usd) * 100);
export const fromCents = (c) => (c / 100);
export const fmt = (c) => `US$${(c / 100).toFixed(2)}`;
export const sumCents = (arr) => arr.reduce((a, b) => a + b, 0);
