const quote = '"';
const escapedQuote = '""""';
const quoteRegExp = new RegExp(quote, 'g');
export default function stringExcel(value) {
    return `"=""${value.replace(quoteRegExp, escapedQuote)}"""`;
}
//# sourceMappingURL=stringExcel.js.map