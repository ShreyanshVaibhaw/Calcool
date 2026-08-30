import { Decimal } from "./value";

// sales-tax phrase config ("$300 + VAT"), set from the app settings
let name = "vat";
let rate = new Decimal(15);

export function setTaxConfig(opts: { name?: string; rate?: number }) {
  if (opts.name?.trim()) name = opts.name.trim().toLowerCase();
  if (opts.rate !== undefined && opts.rate >= 0) rate = new Decimal(opts.rate);
}

export const taxName = () => name;
export const taxRate = () => rate;
