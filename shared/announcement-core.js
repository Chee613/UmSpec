(function (root) {
  'use strict';
  const ORIGIN = 'https://spectrum.um.edu.my';
  const clean = value => String(value ?? '').replace(/([?&]sesskey=)[^&#\s]+/gi, '$1[redacted]').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
  const id = value => /^(?:[1-9]\d*)$/.test(String(value ?? ''));
  function sourceUrl(value, postId) {
    try {
      const url = new URL(value);
      return url.origin === ORIGIN && !url.username && !url.password &&
        ![...url.searchParams.keys()].some(key => /sesskey|token|password|secret|authorization/i.test(key)) &&
        url.pathname === '/mod/forum/discuss.php' && id(url.searchParams.get('d')) &&
        (!url.hash || url.hash === '#p' + postId) ? url.href : null;
    } catch { return null; }
  }
  function httpsUrl(value) {
    try {
      const url = new URL(value);
      if (url.origin === ORIGIN) {
        for (const key of [...url.searchParams.keys()]) {
          if (/^sesskey$/i.test(key)) url.searchParams.delete(key);
          else if (/token|password|secret|authorization/i.test(key)) return null;
        }
      }
      return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 4096 ? url.href : null;
    } catch { return null; }
  }
  function timestamp(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/);
    return match && validDate(match[1]) && +match[2] < 24 && +match[3] < 60 && +(match[4] || 0) < 60 &&
      (!match[6] || (+match[6] <= 14 && +match[7] < 60 && (+match[6] !== 14 || +match[7] === 0))) && Number.isFinite(Date.parse(value)) ? value : null;
  }
  async function normalisePost(post) {
    if (!post || !id(post.courseId) || !id(post.forumId) || !id(post.postId) || !sourceUrl(post.sourceUrl, post.postId)) {
      throw new TypeError('Invalid announcement source identity or URL');
    }
    const title = clean(post.title), text = clean(post.text);
    if (title.length > 500 || text.length > 100000 || !Array.isArray(post.links ?? []) || (post.links ?? []).length > 100) {
      throw new TypeError('Announcement exceeds content limits');
    }
    const links = [...new Set((post.links ?? []).map(httpsUrl).filter(Boolean))].sort();
    const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([title, text, links])));
    return {
      courseId: String(post.courseId), forumId: String(post.forumId), postId: String(post.postId),
      sourceUrl: sourceUrl(post.sourceUrl, post.postId), title, text,
      publishedAt: timestamp(post.publishedAt), modifiedAt: timestamp(post.modifiedAt), links,
      sourceRevision: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    };
  }
  function isReviewStale(candidate, currentPostRevision) {
    return !candidate || !currentPostRevision || candidate.sourceRevision !== currentPostRevision ||
      Boolean(candidate.acceptedRevision && candidate.acceptedRevision !== currentPostRevision);
  }
  const months = {
    january: 1, januari: 1, february: 2, februari: 2, march: 3, mac: 3, april: 4,
    may: 5, mei: 5, june: 6, jun: 6, july: 7, julai: 7, august: 8, ogos: 8,
    september: 9, october: 10, oktober: 10, november: 11, december: 12, disember: 12
  };
  const weekdays = { sunday: 0, ahad: 0, monday: 1, isnin: 1, tuesday: 2, selasa: 2,
    wednesday: 3, rabu: 3, thursday: 4, khamis: 4, friday: 5, jumaat: 5, saturday: 6, sabtu: 6 };
  const pad = value => String(value).padStart(2, '0');
  function validDate(value) {
    if (root.UmSpecCalendarCore) return root.UmSpecCalendarCore.isValidDate(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || +value.slice(0, 4) < 1000) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  function meetingUrl(value) {
    const safe = httpsUrl(value);
    if (!safe) return null;
    const host = new URL(safe).hostname;
    return ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'teams.live.com', 'webex.com']
      .some(domain => host === domain || host.endsWith('.' + domain)) ? safe : null;
  }
  function explicitDates(text) {
    const matches = [];
    const pattern = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\b/gi;
    for (const match of text.matchAll(pattern)) {
      let date;
      if (match[1]) date = `${match[1]}-${match[2]}-${match[3]}`;
      else if (match[4]) date = `${match[6]}-${pad(match[5])}-${pad(match[4])}`;
      else if (months[match[8].toLowerCase()]) date = `${match[9]}-${pad(months[match[8].toLowerCase()])}-${pad(match[7])}`;
      if (date) matches.push({ date: validDate(date) ? date : null, index: match.index });
    }
    return matches;
  }
  function relativeDate(text, publishedAt) {
    const relative = [...text.matchAll(/\b(tomorrow|esok|sunday|ahad|monday|isnin|tuesday|selasa|wednesday|rabu|thursday|khamis|friday|jumaat|saturday|sabtu)\b/gi)];
    if (!relative.length) return { date: null, relative: false };
    if (relative.length > 1) return { date: null, relative: true, multiple: true };
    if (!timestamp(publishedAt)) return { date: null, relative: true };
    const anchor = new Date(Date.parse(publishedAt) + 8 * 3600000);
    const word = relative[0][1].toLowerCase();
    const days = word === 'tomorrow' || word === 'esok' ? 1 : (weekdays[word] - anchor.getUTCDay() + 7) % 7;
    anchor.setUTCDate(anchor.getUTCDate() + days);
    return { date: anchor.toISOString().slice(0, 10), relative: true };
  }
  function times(text) {
    const values = [];
    const pattern = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/gi;
    for (const match of text.matchAll(pattern)) {
      let hour = Number(match[1] ?? match[4]), minute = Number(match[2] ?? match[5] ?? 0);
      if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) continue;
      if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
      values.push({ value: `${pad(hour)}:${pad(minute)}:00`, index: match.index, end: match.index + match[0].length });
    }
    return values;
  }
  function addMinutes(start, minutes) {
    return new Date(Date.parse(start) + (minutes + 480) * 60000).toISOString().slice(0, 19) + '+08:00';
  }
  function extractSuggestions(post) {
    if (!post || typeof post.text !== 'string') return [];
    const text = clean(post.text).slice(0, 100000), title = clean(post.title).slice(0, 500);
    const links = Array.isArray(post.links) ? post.links.slice(0, 100).map(httpsUrl).filter(Boolean) : [];
    const link = links.map(meetingUrl).find(Boolean) || null;
    const activity = links.find(value => {
      const url = new URL(value);
      return url.origin === ORIGIN && /^\/mod\/(?:assign|quiz)\/view\.php$/.test(url.pathname) && id(url.searchParams.get('id'));
    }) || null;
    const segments = text.split(/\n+|(?<=[.!?;])\s+/).filter(Boolean);
    const dated = segments.filter(segment => explicitDates(segment).length || relativeDate(segment, post.publishedAt).relative);
    return (dated.length ? dated : [text]).map(segment => {
      const dates = explicitDates(segment), relative = dates.length ? { relative: false } : relativeDate(segment, post.publishedAt);
      const multiple = dates.length > 1 || relative.multiple;
      const date = multiple ? null : dates.length ? dates[0].date : relative.date;
      const deadlineWords = /\b(due|deadline|submit|submission|hantar|penghantaran|tarikh akhir|assignment|tugasan)\b/i;
      const meetingWords = /\b(meeting|class|lecture|session|taklimat|kelas|kuliah|mesyuarat|sesi)\b/i;
      const kind = /\b(due|deadline|submit|submission|hantar|penghantaran|tarikh akhir)\b/i.test(segment) ? 'deadline' :
        meetingWords.test(segment) ? 'meeting' : deadlineWords.test(segment) ? 'deadline' : link ? 'meeting' :
          meetingWords.test(title) ? 'meeting' : deadlineWords.test(title) ? 'deadline' : 'other';
      const clock = times(segment);
      const range = clock.length === 2 && /^\s*(?:-|–|—|to|until|hingga|sampai)\s*$/i.test(segment.slice(clock[0].end, clock[1].index));
      const startTime = clock.length === 1 || range ? clock[0].value : null;
      const start = date ? date + (startTime ? 'T' + startTime + '+08:00' : '') : null;
      let end = range && start ? date + 'T' + clock[1].value + '+08:00' : null;
      // ponytail: an overnight range requires an explicit duration/end date; never guess the next day.
      if (end && end <= start) end = null;
      const duration = segment.match(/\b(?:for|selama)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|minit|hours?|hrs?|jam)\b/i);
      if (!end && startTime && start && duration) {
        const minutes = Number(duration[1]) * (/^(?:h|jam)/i.test(duration[2]) ? 60 : 1);
        if (minutes > 0 && minutes <= 10080) end = addMinutes(start, minutes);
      }
      const cancellationText = title + ' ' + (dated.length <= 1 ? text : segment);
      const cancellation = /\b(cancelled|canceled|dibatalkan|batal)\b/i.test(cancellationText) &&
        !/\b(not|tidak|belum)\s+(?:cancelled|canceled|dibatalkan|batal)\b/i.test(cancellationText);
      return {
        title, kind, suggestedStart: start, suggestedEnd: end,
        precision: start ? startTime ? 'instant' : 'date' : 'unknown', meetingUrl: link,
        evidence: clean(segment).slice(0, 300), linkedActivityUrl: activity,
        reason: multiple ? 'multiple_dates' : !date ? 'missing_date' : relative.relative ? 'relative' :
          kind === 'meeting' && !startTime ? 'missing_time' : kind === 'meeting' && !end ? 'unknown_end' : 'explicit',
        cancellationSuggested: cancellation
      };
    });
  }
  function validateReview(candidate, editedFields) {
    const fields = editedFields || {}, reasons = [];
    if (!candidate || !candidate.sourceRevision || fields.reviewedRevision !== candidate.sourceRevision) {
      return { valid: false, reasons: ['Review does not match the latest source revision'] };
    }
    if (!id(candidate.courseId) || !id(candidate.postId) || !sourceUrl(candidate.sourceUrl, candidate.postId) ||
        typeof candidate.sourceKey !== 'string' || !candidate.sourceKey.trim() || candidate.sourceKey.length > 1024) {
      reasons.push('Invalid announcement identity');
    }
    const kind = fields.kind ?? candidate.kind;
    if (!['deadline', 'meeting', 'other'].includes(kind)) reasons.push('Invalid event kind');
    const start = fields.start ?? candidate.suggestedStart ?? null;
    let end = Object.hasOwn(fields, 'end') ? fields.end || null : candidate.suggestedEnd || null;
    const precision = fields.precision || (typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start) ? 'date' : 'instant');
    let title = clean(fields.title ?? candidate.title);
    const description = clean(fields.description ?? candidate.evidence);
    const meeting = fields.meetingUrl ?? candidate.meetingUrl ?? null;
    if (!title || title.length > 500 || description.length > 20000) reasons.push('Invalid review text');
    if (meeting && !httpsUrl(meeting)) reasons.push('Invalid meeting URL');
    if (precision === 'date') {
      if (kind === 'meeting') reasons.push('Meetings require a start time and explicit end or duration');
      if (!end && validDate(start)) end = new Date(Date.parse(start + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    } else if (precision === 'instant' && timestamp(start)) {
      if (!end && Number.isInteger(fields.durationMinutes) && fields.durationMinutes > 0 && fields.durationMinutes <= 10080) end = addMinutes(start, fields.durationMinutes);
      if (!end && kind === 'deadline') { end = addMinutes(start, 1); title = 'Due at: ' + title; }
    }
    const event = {
      sourceKey: candidate.sourceKey, sourceType: 'announcement', sourceUrl: candidate.sourceUrl,
      courseId: String(candidate.courseId), title, description, precision, start, end,
      timeZone: 'Asia/Kuala_Lumpur', meetingUrl: meeting || null, status: 'confirmed',
      sourceRevision: candidate.sourceRevision, reminderMinutes: fields.reminderMinutes ?? [1440, 60]
    };
    const calendar = root.UmSpecCalendarCore || (typeof require === 'function' ? require('./calendar-core.js') : null);
    if (!calendar) reasons.push('Calendar validation unavailable');
    else reasons.push(...calendar.validateEvent(event).reasons);
    return reasons.length ? { valid: false, reasons } : { valid: true, reasons: [], event };
  }
  const api = { normalisePost, extractSuggestions, isReviewStale, validateReview };
  root.UmSpecAnnouncements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
