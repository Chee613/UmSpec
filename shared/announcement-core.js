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
    september: 9, october: 10, oktober: 10, november: 11, december: 12, disember: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jul: 7, aug: 8, ogo: 8, sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12
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
  const monthNames = Object.keys(months).sort((a, b) => b.length - a.length).join('|');
  const weekdayNames = Object.keys(weekdays).join('|');
  // ISO, d/m/yyyy (also . or -), "15 Nov 2026" / "15hb Disember", and "November 15, 2026"; the year may be omitted.
  const datePattern = new RegExp('\\b(\\d{4})-(\\d{2})-(\\d{2})\\b' +
    '|\\b(\\d{1,2})([./-])(\\d{1,2})\\5(\\d{4})\\b' +
    '|\\b(\\d{1,2})(?:st|nd|rd|th|\\s*hb\\.?)?\\s+(?:haribulan\\s+)?(' + monthNames + ')\\b\\.?(?:,?\\s+(\\d{4})\\b)?' +
    '|\\b(' + monthNames + ')\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?', 'gi');
  const rangeBefore = /(?<![\d.:/-])\d{1,2}(?:st|nd|rd|th|\s*hb)?\s*(?:-|–|—|to|until|hingga|sehingga|sampai|&|and|dan)\s*$/i;
  const rangeAfter = /^\s*(?:-|–|—|to|until|hingga|sehingga|sampai|&|and|dan)\s*\d{1,2}\b/i;
  const weekdayBefore = new RegExp('\\b(' + weekdayNames + ')\\s*,?\\s*$', 'i');
  const weekdayAfter = new RegExp('^\\s*,?\\s*\\(?\\s*(' + weekdayNames + ')\\b', 'i');
  // A year-less date is read only when exactly one year puts it between a week before and six months after posting.
  function inferYear(month, day, publishedAt) {
    if (!timestamp(publishedAt)) return null;
    const anchor = new Date(Date.parse(publishedAt) + 8 * 3600000);
    const base = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
    for (const year of [anchor.getUTCFullYear() - 1, anchor.getUTCFullYear(), anchor.getUTCFullYear() + 1]) {
      const date = `${year}-${pad(month)}-${pad(day)}`;
      const offset = (Date.UTC(year, month - 1, day) - base) / 86400000;
      if (validDate(date) && offset >= -7 && offset <= 183) return date;
    }
    return null;
  }
  function explicitDates(text, publishedAt) {
    const matches = [];
    for (const match of text.matchAll(datePattern)) {
      let date = null, yearInferred = false;
      const before = text.slice(Math.max(0, match.index - 24), match.index), after = text.slice(match.index + match[0].length);
      if (match[1]) date = `${match[1]}-${match[2]}-${match[3]}`;
      else if (match[4]) date = `${match[7]}-${pad(match[6])}-${pad(match[4])}`;
      else {
        const dayFirst = Boolean(match[8]), word = dayFirst ? match[9] : match[11];
        const day = Number(dayFirst ? match[8] : match[12]), year = dayFirst ? match[10] : match[13];
        // Lower-case "may" without a year is the verb ("groups of 3 may submit"), not a month.
        if (!year && /^may$/i.test(word) && word !== 'May') continue;
        // "15-16 Dec" or "Dec 15-16" spans days; counting it twice keeps it out of a single-date suggestion.
        if ((dayFirst && rangeBefore.test(before)) || (!dayFirst && rangeAfter.test(after))) matches.push({ date: null, index: match.index });
        if (year) date = `${year}-${pad(months[word.toLowerCase()])}-${pad(day)}`;
        else { date = inferYear(months[word.toLowerCase()], day, publishedAt); yearInferred = Boolean(date); }
      }
      if (date && !validDate(date)) date = null;
      // A weekday written beside the date must agree with it, or neither is trusted.
      const named = (weekdayBefore.exec(before) || weekdayAfter.exec(after))?.[1];
      if (date && named && weekdays[named.toLowerCase()] !== new Date(date + 'T00:00:00Z').getUTCDay()) date = null;
      matches.push({ date, index: match.index, yearInferred: yearInferred && Boolean(date) });
    }
    return matches;
  }
  function relativeDate(text, publishedAt) {
    const relative = [...text.matchAll(/\b(?:(next|this|coming)\s+)?(today|tonight|hari ini|malam ini|tomorrow|esok|lusa|sunday|ahad|monday|isnin|tuesday|selasa|wednesday|rabu|thursday|khamis|friday|jumaat|saturday|sabtu)(?:\s+(depan|hadapan|ini))?\b/gi)];
    if (!relative.length) return { date: null, relative: false };
    if (relative.length > 1) return { date: null, relative: true, multiple: true };
    const [, prefix, rawWord, suffix] = relative[0], word = rawWord.toLowerCase().replace(/\s+/g, ' ');
    // "next Friday" and "Jumaat depan" mean different days to different writers.
    if (weekdays[word] !== undefined && (/^next$/i.test(prefix || '') || /^(?:depan|hadapan)$/i.test(suffix || '') ||
        /\bnext week\b|\bminggu (?:depan|hadapan)\b/i.test(text))) return { date: null, relative: true };
    if (!timestamp(publishedAt)) return { date: null, relative: true };
    const anchor = new Date(Date.parse(publishedAt) + 8 * 3600000);
    const offsets = { today: 0, tonight: 0, 'hari ini': 0, 'malam ini': 0, tomorrow: 1, esok: 1, lusa: 2 };
    const days = offsets[word] ?? (weekdays[word] - anchor.getUTCDay() + 7) % 7;
    anchor.setUTCDate(anchor.getUTCDate() + days);
    return { date: anchor.toISOString().slice(0, 10), relative: true };
  }
  // 2 pm, 2.30pm, 10 a.m., 2.30 petang, 10 pagi, 14:30, 1430hrs.
  const timePattern = new RegExp('\\b(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?|pagi|tengah\\s*hari|petang|malam)(?![a-z])' +
    '|\\b(\\d{1,2}):(\\d{2})(?:\\s*(?:hrs?|h)\\b)?|\\b([01]\\d|2[0-3])\\.?([0-5]\\d)\\s*(?:hrs?|h)\\b', 'gi');
  const rangeStart = /(?<![\d.:/-])(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|to|until|hingga|sehingga|sampai)\s*$/i;
  function clockHour(hour, word) {
    const value = word.toLowerCase().replace(/[.\s]/g, '');
    if (value === 'am') return hour >= 1 && hour <= 12 ? hour % 12 : null;
    if (value === 'pm') return hour >= 1 && hour <= 12 ? hour % 12 + 12 : null;
    if (value === 'pagi') return hour >= 1 && hour <= 11 ? hour : null;
    if (value === 'tengahhari') return hour === 11 || hour === 12 ? hour : hour >= 1 && hour <= 3 ? hour + 12 : null;
    if (value === 'petang') return hour >= 1 && hour <= 7 ? hour + 12 : null;
    if (value === 'malam') return hour >= 7 && hour <= 11 ? hour + 12 : null;
    return null;
  }
  function times(text) {
    const values = [];
    for (const match of text.matchAll(timePattern)) {
      const word = match[3];
      let hour = Number(match[1] ?? match[4] ?? match[6]);
      const minute = Number(match[2] ?? match[5] ?? match[7] ?? 0);
      if (minute > 59) continue;
      if (word) hour = clockHour(hour, word);
      if (hour === null || hour > 23) continue;
      // "2-4 pm" shares one marker; the bare start is kept only if the shared marker keeps the range in order.
      const open = word && rangeStart.exec(text.slice(0, match.index));
      if (open && !values.some(value => value.end > open.index)) {
        const startHour = clockHour(Number(open[1]), word), startMinute = Number(open[2] ?? 0);
        const ordered = startHour !== null && startMinute <= 59 && startHour * 60 + startMinute < hour * 60 + minute;
        // "11-1pm" is unreadable: record an unknown start so the marked end is never used as the start.
        values.push({ value: ordered ? `${pad(startHour)}:${pad(startMinute)}:00` : null, index: open.index,
          end: open.index + open[0].search(/\s*(?:-|–|—|to|until|hingga|sehingga|sampai)\s*$/i) });
      }
      values.push({ value: `${pad(hour)}:${pad(minute)}:00`, index: match.index, end: match.index + match[0].length });
    }
    return values;
  }
  function addMinutes(start, minutes) {
    return new Date(Date.parse(start) + (minutes + 480) * 60000).toISOString().slice(0, 19) + '+08:00';
  }
  // A suggestion whose day (or timed end) is already over cannot become a useful Calendar entry.
  function isPast(suggestion, now) {
    const value = suggestion.suggestedEnd || suggestion.suggestedStart;
    if (!value) return false;
    return Date.parse(value.length === 10 ? value + 'T23:59:59+08:00' : value) < now;
  }
  function extractSuggestions(post, options = {}) {
    if (!post || typeof post.text !== 'string') return [];
    const text = clean(post.text).slice(0, 100000), title = clean(post.title).slice(0, 500);
    const links = Array.isArray(post.links) ? post.links.slice(0, 100).map(httpsUrl).filter(Boolean) : [];
    const link = links.map(meetingUrl).find(Boolean) || null;
    const activity = links.find(value => {
      const url = new URL(value);
      return url.origin === ORIGIN && /^\/mod\/(?:assign|quiz)\/view\.php$/.test(url.pathname) && id(url.searchParams.get('id'));
    }) || null;
    // Sentence breaks skip "a.m.", initials and abbreviated months so "2 p.m. to 4 p.m." stays one segment.
    const segments = text.split(/\n+|(?<=[!?;]|(?<!\b(?:[ap]\.m|[a-z]|dr|prof|mr|mrs|ms|no|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|okt|nov|dec|dis))\.)\s+/i).filter(Boolean);
    const published = post.publishedAt;
    const dated = segments.filter(segment => explicitDates(segment, published).length || relativeDate(segment, published).relative);
    if (!dated.length && explicitDates(title, published).length) dated.push(title);
    const deadlineWords = /\b(due|deadline|submit|submission|hantar|penghantaran|tarikh akhir|assignment|tugasan)\b/i;
    const meetingWords = /\b(meeting|class|lecture|session|taklimat|kelas|kuliah|mesyuarat|sesi)\b/i;
    const content = title + ' ' + text;
    const namedDateHint = [...content.matchAll(/\b\d{1,2}(?:st|nd|rd|th)?\s+([A-Za-z]+)\b/g)].some(match =>
      months[match[1].toLowerCase()] && !(/^may$/i.test(match[1]) && match[1] !== 'May'));
    // Keyword-only posts ("assignment released", a bare meeting link) carry no date to review, so they are not queued.
    if (!dated.length && !namedDateHint && !/\b(?:week|minggu)\s+\d+\b|\bnext week\b|\bminggu (?:depan|hadapan)\b/i.test(content)) return [];
    const singleDate = explicitDates(title + '\n' + text, published).length === 1;
    const suggestions = (dated.length ? dated : [text]).map(segment => {
      // ponytail: borrow only one time-only neighbouring line for one explicit date.
      if (singleDate && dated.length === 1 && !times(segment).length) {
        const lines = text.split('\n'), index = lines.indexOf(segment);
        const adjacent = (segment === title ? [lines[0]] : index < 0 ? [] : [lines[index - 1], lines[index + 1]]).filter(line => {
          if (!line) return false;
          const clock = times(line);
          return clock.length > 0 && clock.length <= 2 &&
            /^(?:(?:time|masa|pukul|jam|at|from|dari)\s*:?\s*)?$/i.test(line.slice(0, clock[0].index)) &&
            /^\s*(?:(?:for|selama)\s+\d+(?:\.\d+)?\s*(?:minutes?|mins?|minit|hours?|hrs?|jam))?[.!]?\s*$/i.test(line.slice(clock.at(-1).end)) &&
            (clock.length === 1 || /^\s*(?:-|–|—|to|until|hingga|sehingga|sampai)\s*$/i.test(line.slice(clock[0].end, clock[1].index)));
        });
        if (adjacent.length === 1) segment += '\n' + adjacent[0];
      }
      const dates = explicitDates(segment, published), relative = dates.length ? { relative: false } : relativeDate(segment, published);
      const multiple = dates.length > 1 || relative.multiple;
      const date = multiple ? null : dates.length ? dates[0].date : relative.date;
      const kind = /\b(due|deadline|submit|submission|hantar|penghantaran|tarikh akhir)\b/i.test(segment) ? 'deadline' :
        meetingWords.test(segment) ? 'meeting' : deadlineWords.test(segment) ? 'deadline' : link ? 'meeting' :
          meetingWords.test(title) ? 'meeting' : deadlineWords.test(title) ? 'deadline' : 'other';
      const clock = times(segment);
      const range = clock.length === 2 && clock.every(entry => entry.value) && /^\s*(?:-|–|—|to|until|hingga|sehingga|sampai)\s*$/i.test(segment.slice(clock[0].end, clock[1].index));
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
          kind === 'meeting' && !startTime ? 'missing_time' : kind === 'meeting' && !end ? 'unknown_end' :
            dates[0]?.yearInferred ? 'inferred_year' : 'explicit',
        cancellationSuggested: cancellation
      };
    });
    return Number.isFinite(options.now) ? suggestions.filter(suggestion => !isPast(suggestion, options.now)) : suggestions;
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
