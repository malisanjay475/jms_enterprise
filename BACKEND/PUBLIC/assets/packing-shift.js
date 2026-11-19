/*
 * Packing works one day shift, 09:00 to 17:00. Plan maths uses working minutes inside
 * that window: a job that does not fit today carries on at 09:00 the next day.
 * Used by the packing plan board (assembly.html) and the station screen (scan_station.html).
 */
(function (g) {
    const START_H = 9, END_H = 17;
    const S = START_H * 60, E = END_H * 60;
    const DAY_MS = 86400000;

    const minOfDay = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const atMin = (d, m, addDays = 0) => {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        if (addDays) x.setDate(x.getDate() + addDays);
        x.setMinutes(m);
        return x;
    };

    /* The first working moment at or after d. */
    function snap(d) {
        const t = new Date(d);
        const m = minOfDay(t);
        if (m < S) return atMin(t, S);
        if (m >= E) return atMin(t, S, 1);
        return t;
    }

    /* d plus `mins` working minutes. */
    function addWork(d, mins) {
        let t = snap(d);
        let left = Math.max(0, Number(mins) || 0);
        for (let i = 0; i < 2000 && left > 0; i++) {
            const room = E - minOfDay(t);
            if (left <= room) return new Date(t.getTime() + left * 60000);
            left -= room;
            t = atMin(t, S, 1);
        }
        return t;
    }

    /* Working minutes between a and b. */
    function workBetween(a, b) {
        a = new Date(a); b = new Date(b);
        if (!(b > a)) return 0;
        let total = 0;
        for (let day = atMin(a, 0), i = 0; day < b && i < 2000; day = new Date(day.getTime() + DAY_MS), i++) {
            const from = Math.max(a.getTime(), atMin(day, S).getTime());
            const to = Math.min(b.getTime(), atMin(day, E).getTime());
            if (to > from) total += (to - from) / 60000;
        }
        return total;
    }

    const inShift = (d) => { const m = minOfDay(new Date(d)); return m >= S && m < E; };

    /* Wall-clock text for a naive TIMESTAMP column: 2026-11-20T09:30:00 (no time zone). */
    function localIso(d) {
        const x = new Date(d);
        const p = (n) => String(n).padStart(2, '0');
        return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
    }

    /* "14:30", "tomorrow 10:15" or "22-Nov 10:15". */
    function whenText(d, now = new Date()) {
        const x = new Date(d);
        const hm = x.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
        const days = Math.round((atMin(x, 0) - atMin(now, 0)) / DAY_MS);
        if (days === 0) return hm;
        if (days === 1) return `tomorrow ${hm}`;
        return `${x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).replace(' ', '-')} ${hm}`;
    }

    g.PackShift = { START_H, END_H, MIN_PER_DAY: E - S, label: '09:00 – 17:00', snap, addWork, workBetween, inShift, localIso, whenText };
})(window);
