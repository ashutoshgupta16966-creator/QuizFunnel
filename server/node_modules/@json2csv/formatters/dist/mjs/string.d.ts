import type Formatter from './Formatter.js';
export interface StringFormatterOptions {
    quote?: string;
    escapedQuote?: string;
}
export default function stringFormatter(opts?: StringFormatterOptions): Formatter<string>;
//# sourceMappingURL=string.d.ts.map