import defaulStringFormatter from './string.js';
export default function objectFormatter(opts = { stringFormatter: defaulStringFormatter() }) {
    return (value) => {
        if (value === null)
            return '';
        let stringifiedValue = JSON.stringify(value);
        if (stringifiedValue === undefined)
            return '';
        if (stringifiedValue[0] === '"')
            stringifiedValue = stringifiedValue.replace(/^"(.+)"$/, '$1');
        return opts.stringFormatter(stringifiedValue);
    };
}
//# sourceMappingURL=object.js.map