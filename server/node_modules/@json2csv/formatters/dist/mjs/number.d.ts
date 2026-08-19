import type Formatter from './Formatter.js';
export interface NumberFormatterOptions {
    separator?: string;
    decimals?: number;
}
export default function numberFormatter<T extends number>(opts?: NumberFormatterOptions): Formatter<T>;
//# sourceMappingURL=number.d.ts.map