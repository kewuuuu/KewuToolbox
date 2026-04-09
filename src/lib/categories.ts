import { Category } from '@/types';

export const CATEGORY_COLORS: Record<Category, string> = {
  '学习': 'cat-study',
  '娱乐': 'cat-entertainment',
  '社交': 'cat-social',
  '休息': 'cat-rest',
  '其他': 'cat-other',
};

export const CATEGORY_HEX: Record<Category, string> = {
  '学习': '#3b82f6',
  '娱乐': '#f59e0b',
  '社交': '#a855f7',
  '休息': '#22c55e',
  '其他': '#6b7280',
};

export const CATEGORIES: Category[] = ['学习', '娱乐', '社交', '休息', '其他'];

export function getCategoryColor(cat: Category): string {
  return CATEGORY_HEX[cat] || CATEGORY_HEX['其他'];
}

export function getCategoryClass(cat: Category): string {
  return CATEGORY_COLORS[cat] || CATEGORY_COLORS['其他'];
}
