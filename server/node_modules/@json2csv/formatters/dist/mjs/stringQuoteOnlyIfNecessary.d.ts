import type Formatter from './Formatter.js';
import { type StringFormatterOptions } from './string.js';
export interface StringFQuoteOnlyIfNecesaryFormatterOptions extends StringFormatterOptions {
    separator?: string;
    eol?: string;
}
export default function stringQuoteOnlyIfNecessaryFormatter(opts?: StringFQuoteOnlyIfNecesaryFormatterOptions): Formatter<string>;
//# sourceMappingURL=stringQuoteOnlyIfNecessary.d.ts.map