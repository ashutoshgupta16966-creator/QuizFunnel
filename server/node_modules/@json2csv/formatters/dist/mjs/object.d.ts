import type Formatter from './Formatter.js';
export default function objectFormatter<T extends object>(opts?: {
    stringFormatter: Formatter<string>;
}): Formatter<T>;
//# sourceMappingURL=object.d.ts.map