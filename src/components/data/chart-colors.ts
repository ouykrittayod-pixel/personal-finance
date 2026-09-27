/**
 * Chart colours as CSS variable references (see styles/tokens.css).
 * Semantic series (income/expense/debt) always use their semantic colour;
 * categorical series use the calm 1–5 palette in order.
 */
export const CHART_COLORS = {
  income: 'var(--chart-income)',
  expense: 'var(--chart-expense)',
  debt: 'var(--chart-debt)',
  series: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'],
} as const
