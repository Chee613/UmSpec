(function (root) {
  'use strict';
  const TIME_ZONE = 'Asia/Kuala_Lumpur';
  const encoder = new TextEncoder();
  const hashParts = parts => (root.UmSpecSync || require('./sync-core.js')).hashParts(parts);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const safeUrl = (value, spectrum = false) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && (!spectrum || (url.origin === 'https://spectrum.um.edu.my' && ![...url.searchParams.keys()].some(key => /sesskey|token|password|secret|authorization/i.test(key))));
    } catch { return false; }
  };
  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    return year >= 1000 && new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
  }
  function isInstant(value) {
    if (typeof value !== 'string') return false;
    const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
    return !!match && isValidDate(match[1]) && +match[2] < 24 && +match[3] < 60 && +match[4] < 60 &&
      (!match[6] || (+match[6] <= 14 && +match[7] < 60 && (+match[6] !== 14 || +match[7] === 0))) && Number.isFinite(Date.parse(value));
  }
  function validateEvent(record) {
    const r = record || {}, reasons = [];
    if (!text(r.sourceKey) || encoder.encode(r.sourceKey).length > 1024) reasons.push('Invalid source identity');
    if (!['moodle', 'announcement', 'proforma'].includes(r.sourceType)) reasons.push('Invalid source type');
    if (!safeUrl(r.sourceUrl, true)) reasons.push('Invalid Spectrum source URL');
    if (!/^\d+$/.test(String(r.courseId || ''))) reasons.push('Invalid course ID');
    if (!text(r.title) || r.title.length > 10000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r.title) || (r.description != null && (typeof r.description !== 'string' || r.description.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r.description)))) reasons.push('Invalid event text');
    if (r.timeZone !== TIME_ZONE) reasons.push('Invalid time zone');
    if (r.meetingUrl != null && !safeUrl(r.meetingUrl)) reasons.push('Invalid meeting URL');
    if (!['confirmed', 'needs_review', 'cancelled'].includes(r.status)) reasons.push('Invalid status');
    if (!text(r.sourceRevision) || encoder.encode(r.sourceRevision).length > 1024) reasons.push('Invalid source revision');
    const reminders = r.reminderMinutes;
    if (!Array.isArray(reminders) || reminders.length > 5 || new Set(reminders).size !== reminders.length || reminders.some(n => !Number.isInteger(n) || n < 0 || n > 40320)) reasons.push('Invalid reminders');
    if (r.precision === 'date') {
      if (!isValidDate(r.start) || !isValidDate(r.end) || r.end <= r.start) reasons.push('Invalid all-day dates');
    } else if (r.precision === 'instant') {
      if (!isInstant(r.start) || !isInstant(r.end) || Date.parse(r.end) <= Date.parse(r.start)) reasons.push('Invalid timed dates');
    } else if (r.precision !== 'unknown' || r.start !== null || r.end !== null || r.status === 'confirmed') reasons.push('Unknown dates require review');
    return { valid: !reasons.length, reasons };
  }
  function stableEventId(bindingHash, sourceKey) {
    if (!text(bindingHash) || !text(sourceKey)) throw new Error('Missing event identity');
    return hashParts([bindingHash, sourceKey]);
  }
  function buildGoogleEvent(record, id) {
    const validation = validateEvent(record);
    if (!validation.valid || record.status !== 'confirmed') throw new Error('Event is not confirmed: ' + validation.reasons.join('; '));
    const payload = {
      summary: record.title,
      description: (record.description || '') + (record.meetingUrl ? '\nMeeting: ' + record.meetingUrl : '') + '\nSource: ' + record.sourceUrl,
      location: record.meetingUrl || '',
      start: record.precision === 'date' ? { date: record.start } : { dateTime: record.start, timeZone: TIME_ZONE },
      end: record.precision === 'date' ? { date: record.end } : { dateTime: record.end, timeZone: TIME_ZONE },
      reminders: { useDefault: false, overrides: [...record.reminderMinutes].sort((a, b) => a - b).map(minutes => ({ method: 'popup', minutes })) }
    };
    if (id != null) {
      if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid Google event ID');
      payload.id = id;
    }
    return payload;
  }
  function escapeICS(value) { return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
  function foldICS(line) {
    let folded = '', octets = 0;
    for (const char of line) {
      const length = encoder.encode(char).length;
      if (octets + length > 75) { folded += '\r\n '; octets = 1; }
      folded += char;
      octets += length;
    }
    return folded;
  }
  const utcICS = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  async function generateICS(records, generatedAt = new Date()) {
    if (!Number.isFinite(new Date(generatedAt).getTime())) throw new Error('Invalid generation timestamp');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UM Spec//Verified dates//EN', 'CALSCALE:GREGORIAN'];
    for (const record of records) {
      if (record.status !== 'confirmed' || !validateEvent(record).valid) continue;
      const payload = buildGoogleEvent(record);
      lines.push('BEGIN:VEVENT', 'UID:' + await stableEventId('ics', record.sourceKey) + '@umspec', 'DTSTAMP:' + utcICS(generatedAt));
      if (record.precision === 'date') lines.push('DTSTART;VALUE=DATE:' + record.start.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + record.end.replace(/-/g, ''));
      else lines.push('DTSTART:' + utcICS(record.start), 'DTEND:' + utcICS(record.end));
      lines.push('SUMMARY:' + escapeICS(payload.summary), 'DESCRIPTION:' + escapeICS(payload.description));
      if (payload.location) lines.push('LOCATION:' + escapeICS(payload.location));
      lines.push('URL:' + escapeICS(record.sourceUrl));
      for (const minutes of record.reminderMinutes) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT' + minutes + 'M', 'END:VALARM');
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldICS).join('\r\n') + '\r\n';
  }
  function malaysiaInstant(seconds) {
    return new Date(seconds * 1000 + 8 * 3600000).toISOString().slice(0, 19) + '+08:00';
  }
  function normaliseMoodleEvent(raw, sourceUrl) {
    if (!raw || !/^\d+$/.test(String(raw.id || '')) || !Number.isFinite(raw.startSeconds) || !Number.isInteger(raw.startSeconds) || raw.startSeconds < 0 || !Number.isFinite(raw.durationSeconds) || raw.durationSeconds < 0 || !['deadline', 'meeting'].includes(raw.kind)) throw new Error('Invalid official event timestamps or kind');
    const pending = raw.kind === 'meeting' && !raw.durationSeconds;
    const duration = raw.durationSeconds || (raw.kind === 'deadline' ? 60 : 0);
    const record = {
      sourceKey: 'moodle:course:' + raw.courseId + ':event:' + raw.id, sourceType: 'moodle', sourceUrl,
      courseId: String(raw.courseId), title: raw.kind === 'deadline' && !raw.durationSeconds ? 'Due at: ' + raw.title : raw.title,
      description: raw.description || '', precision: pending ? 'unknown' : 'instant',
      start: pending ? null : malaysiaInstant(raw.startSeconds), end: pending ? null : malaysiaInstant(raw.startSeconds + duration),
      timeZone: TIME_ZONE, meetingUrl: raw.meetingUrl || null, status: raw.cancelled ? 'cancelled' : pending ? 'needs_review' : 'confirmed',
      sourceRevision: raw.revision, reminderMinutes: raw.reminderMinutes || [1440, 60]
    };
    const result = validateEvent(record);
    if (!result.valid) throw new Error(result.reasons.join('; '));
    return record;
  }
  function canonicalTime(value) {
    if (value?.date) return { date: value.date };
    return { dateTime: value?.dateTime && Number.isFinite(Date.parse(value.dateTime)) ? new Date(value.dateTime).toISOString() : value?.dateTime || '', timeZone: value?.timeZone || TIME_ZONE };
  }
  function eventPayloadHash(payload) {
    return hashParts([
      payload.summary || '', payload.description || '', payload.location || '', canonicalTime(payload.start), canonicalTime(payload.end),
      { useDefault: payload.reminders?.useDefault === true, overrides: (payload.reminders?.overrides || []).map(r => ({ method: r.method, minutes: r.minutes })).sort((a, b) => a.minutes - b.minutes || String(a.method).localeCompare(String(b.method))) }
    ]);
  }
  function decideEventAction(record, remote, currentRemoteHash) {
    if (record.status !== 'confirmed' || !validateEvent(record).valid) return 'review';
    if (!remote) return 'create';
    const owned = remote.extendedProperties?.private || {};
    if (owned.umspecSource !== record.sourceKey) return 'review';
    if (remote.status === 'cancelled') return 'restore';
    if (!owned.umspecAppliedHash || owned.umspecAppliedHash !== currentRemoteHash) return 'review';
    return owned.umspecRevision === record.sourceRevision && (!record.payloadHash || record.payloadHash === currentRemoteHash) ? 'skip' : 'update';
  }
  function upcomingRecords(records, now = new Date(), days = 7) {
    const time = new Date(now).getTime(), horizon = time + days * 86400000;
    if (!Number.isFinite(time) || !Number.isFinite(days) || days <= 0) return [];
    const instant = (r, key) => Date.parse(r.precision === 'date' ? r[key] + 'T00:00:00+08:00' : r[key]);
    return records.filter(r => r.status === 'confirmed' && validateEvent(r).valid && instant(r, 'end') > time && instant(r, 'start') < horizon).sort((a, b) => instant(a, 'start') - instant(b, 'start') || a.sourceKey.localeCompare(b.sourceKey));
  }
  const api = { validateEvent, isValidDate, stableEventId, buildGoogleEvent, generateICS, normaliseMoodleEvent, eventPayloadHash, decideEventAction, upcomingRecords };
  root.UmSpecCalendarCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
