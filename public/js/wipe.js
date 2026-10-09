'use strict';

function easternTime(y, m, d, h) {
    let t = Date.UTC(y, m, d, h + 5);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t));
    const nyHour = Number(parts.find(p => p.type === 'hour').value);
    return t - (nyHour - h) * 3600e3;
}

function forcedWipe(y, m) {
    const firstDay = new Date(Date.UTC(y, m, 1)).getUTCDay();
    return easternTime(y, m, 1 + ((4 - firstDay + 7) % 7), 14);
}

function nextForcedWipe(now = Date.now()) {
    const d = new Date(now);
    const thisMonth = forcedWipe(d.getUTCFullYear(), d.getUTCMonth());
    return thisMonth > now ? thisMonth : forcedWipe(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

function nextServerWipe(lastWipe, flags = [], now = Date.now()) {
    const forced = nextForcedWipe(now);
    const every = flags.includes('weekly') ? 7 : flags.includes('biweekly') ? 14 : 0;
    if (!lastWipe || !every) return { at: forced, forced: true };
    let at = lastWipe + every * 86400e3;
    while (at < now) at += every * 86400e3;
    return at < forced - 86400e3 ? { at, forced: false } : { at: forced, forced: true };
}

if (typeof module !== 'undefined') module.exports = { nextForcedWipe, nextServerWipe, forcedWipe };
