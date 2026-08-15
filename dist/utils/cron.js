const FIELDS = {
    minute: { min: 0, max: 59 },
    hour: { min: 0, max: 23 },
    dom: { min: 1, max: 31 },
    month: { min: 1, max: 12 },
    dow: { min: 0, max: 6 },
};
function clamp(n, spec) {
    return Math.max(spec.min, Math.min(spec.max, n));
}
function parseIntStrict(s) {
    if (!/^-?\d+$/.test(s))
        return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
function expandRange(start, end, step, spec) {
    const out = [];
    const a = clamp(start, spec);
    const b = clamp(end, spec);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const st = Math.max(1, step);
    for (let v = lo; v <= hi; v += st)
        out.push(v);
    return out;
}
function parseField(field, spec, normalize) {
    const out = new Set();
    const f = field.trim();
    if (!f)
        return out;
    const add = (n) => {
        const v = normalize ? normalize(n) : n;
        if (v >= spec.min && v <= spec.max)
            out.add(v);
    };
    const parts = f.split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
        if (part === '*') {
            for (let i = spec.min; i <= spec.max; i++)
                add(i);
            continue;
        }
        const stepIdx = part.indexOf('/');
        const base = stepIdx >= 0 ? part.slice(0, stepIdx) : part;
        const stepRaw = stepIdx >= 0 ? part.slice(stepIdx + 1) : '';
        const step = stepIdx >= 0 ? (parseIntStrict(stepRaw) ?? 1) : 1;
        if (base === '*') {
            for (let i = spec.min; i <= spec.max; i += Math.max(1, step))
                add(i);
            continue;
        }
        const dashIdx = base.indexOf('-');
        if (dashIdx >= 0) {
            const aRaw = base.slice(0, dashIdx);
            const bRaw = base.slice(dashIdx + 1);
            const a = parseIntStrict(aRaw);
            const b = parseIntStrict(bRaw);
            if (a === null || b === null)
                continue;
            for (const v of expandRange(a, b, step, spec))
                add(v);
            continue;
        }
        const n = parseIntStrict(base);
        if (n === null)
            continue;
        add(n);
    }
    return out;
}
export function parseCronExpression(expr) {
    const parts = expr.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 5)
        return null;
    const [min, hour, dom, month, dow] = parts;
    const minutes = parseField(min, FIELDS.minute);
    const hours = parseField(hour, FIELDS.hour);
    const daysOfMonth = parseField(dom, FIELDS.dom);
    const months = parseField(month, FIELDS.month);
    const daysOfWeek = parseField(dow, FIELDS.dow, n => (n === 7 ? 0 : n));
    if (minutes.size === 0 || hours.size === 0 || daysOfMonth.size === 0 || months.size === 0 || daysOfWeek.size === 0) {
        return null;
    }
    return { minutes, hours, dom: daysOfMonth, months, dow: daysOfWeek };
}
export function cronMatches(expr, date) {
    const parsed = parseCronExpression(expr);
    if (!parsed)
        return false;
    const m = date.getMinutes();
    const h = date.getHours();
    const dom = date.getDate();
    const mon = date.getMonth() + 1;
    const dow = date.getDay();
    return (parsed.minutes.has(m) &&
        parsed.hours.has(h) &&
        parsed.dom.has(dom) &&
        parsed.months.has(mon) &&
        parsed.dow.has(dow));
}
export function minuteBucket(ts) {
    const d = new Date(ts);
    d.setSeconds(0, 0);
    return d.getTime();
}
