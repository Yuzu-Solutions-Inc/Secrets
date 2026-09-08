import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}

export function formatMoney(amount: number, currency = "¤") {
  return `${new Intl.NumberFormat("fr-CA").format(amount / 100)} ${currency}`;
}
