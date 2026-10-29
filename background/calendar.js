(function (root) {
  'use strict';
  const core = () => root.UmSpecCalendarCore || require('../shared/calendar-core.js');
  const BASE = '/calendar/v3';
  function failure(message, code, status) { return Object.assign(new Error(message), { code, status }); }
  function checkBinding(binding) {
    if (!binding || typeof binding.hash !== 'string' || !binding.hash || new TextEncoder().encode(binding.hash).length > 1024 || /[\u0000-\u001f]/.test(binding.hash) || !binding.spectrumUserId || !binding.googleSub) throw failure('A verified account binding is required', 'INVALID_BINDING');
  }
  async function request(path, options = {}) {
    if (!root.UmSpecGoogle?.googleFetch) throw failure('Google Calendar connection unavailable', 'CALENDAR_UNAVAILABLE');
    const response = await root.UmSpecGoogle.googleFetch(path, options, 'calendar');
    if (!response.ok) throw failure('Google Calendar request failed (' + response.status + ')', 'CALENDAR_HTTP', response.status);
    return response.status === 204 ? null : response.json();
  }
  const jsonOptions = (method, payload, headers = {}) => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  const calendarPath = id => BASE + '/calendars/' + encodeURIComponent(id);
  const marker = binding => 'umspec:v1:' + binding.hash;
  function adopt(binding, calendar) {
    if (!calendar?.id || calendar.description !== marker(binding)) throw failure('Calendar ownership marker does not match', 'CALENDAR_OWNERSHIP');
    binding.calendarId = calendar.id;
    delete binding.calendarCreateIntent;
    return { id: calendar.id, etag: calendar.etag };
  }
  async function ensureCalendar(binding, interactive = false, persistBinding = async () => {}) {
    checkBinding(binding);
    if (binding.calendarId) {
      try { return adopt(binding, await request(calendarPath(binding.calendarId), { interactive })); }
      catch (error) {
        if (error.status === 404 || error.status === 410) throw failure('Managed calendar was deleted; choose a replacement explicitly', 'CALENDAR_DELETED', error.status);
        throw error;
      }
    }
    const matches = [], tokens = new Set();
    let pageToken;
    do {
      const page = await request(BASE + '/users/me/calendarList?maxResults=250' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), { interactive });
      if (!Array.isArray(page.items)) throw failure('Calendar listing is incomplete', 'CALENDAR_INCOMPLETE');
      for (const item of page.items) if (item.description === marker(binding) && !item.deleted) matches.push(item);
      pageToken = page.nextPageToken;
      if (pageToken && tokens.has(pageToken)) throw failure('Calendar pagination repeated', 'CALENDAR_INCOMPLETE');
      if (pageToken) tokens.add(pageToken);
    } while (pageToken);
    if (matches.length > 1) throw failure('Multiple managed calendars match; explicit selection is required', 'CALENDAR_AMBIGUOUS');
    if (matches.length) return adopt(binding, matches[0]);
    if (!binding.calendarCreateIntent) {
      // The worker persists this binding before calling again, so a restart can reconcile creation.
      binding.calendarCreateIntent = { state: 'prepared' };
      return { id: null, pending: true };
    }
    if (binding.calendarCreateIntent.state !== 'prepared') throw failure('Calendar creation is uncertain; no matching calendar was found yet', 'CALENDAR_CREATE_UNCERTAIN');
    binding.calendarCreateIntent.state = 'uncertain';
    await persistBinding();
    const options = jsonOptions('POST', { summary: 'UM Spec', description: marker(binding), timeZone: 'Asia/Kuala_Lumpur' });
    options.interactive = interactive;
    options.retry = false;
    return adopt(binding, await request(BASE + '/calendars', options));
  }
  async function readEvent(path) {
    try { return await request(path); }
    catch (error) {
      if (error.status === 404) return null;
      if (error.status === 410) return { status: 'cancelled' };
      throw error;
    }
  }
  async function syncEvent(binding, record, persistBinding) {
    checkBinding(binding);
    const calendar = core(), validation = calendar.validateEvent(record);
    if (!validation.valid) throw failure('Invalid calendar event: ' + validation.reasons.join('; '), 'INVALID_EVENT');
    const eventId = await calendar.stableEventId(binding.hash, record.sourceKey);
    const result = (action, reason) => ({ action, eventId, ...(reason ? { reason } : {}) });
    if (record.status !== 'confirmed') return result('review', record.status === 'cancelled' ? 'Source cancellation requires review' : 'Confirm the source date first');
    const managed = await ensureCalendar(binding, false, persistBinding);
    if (!managed.id) return result('pending', 'Persist calendar creation intent and retry');
    const payload = calendar.buildGoogleEvent({ ...record, reminderMinutes: binding.settings?.reminderMinutes ?? record.reminderMinutes }, eventId);
    const payloadHash = await calendar.eventPayloadHash(payload);
    const path = calendarPath(managed.id) + '/events/' + encodeURIComponent(eventId);
    const checkpoints = binding.calendarEvents || (binding.calendarEvents = {});
    const save = () => { checkpoints[eventId] = { sourceKey: record.sourceKey, sourceRevision: record.sourceRevision, appliedHash: payloadHash }; };
    const properties = { umspecBinding: binding.hash, umspecSource: record.sourceKey, umspecRevision: record.sourceRevision, umspecAppliedHash: payloadHash };
    let remote = await readEvent(path);
    function ownershipMatches(value) { return value?.extendedProperties?.private?.umspecBinding === binding.hash && value.extendedProperties.private.umspecSource === record.sourceKey; }
    async function actionFor(value) {
      if (value?.status === 'cancelled') return 'restore';
      if (!value) return checkpoints[eventId] ? 'restore' : 'create';
      if (!ownershipMatches(value)) return 'review';
      return calendar.decideEventAction({ ...record, payloadHash }, value, await calendar.eventPayloadHash(value));
    }
    let action = await actionFor(remote);
    if (action === 'create') {
      payload.extendedProperties = { private: properties };
      try {
        await request(calendarPath(managed.id) + '/events?sendUpdates=none', { ...jsonOptions('POST', payload), idempotent: true });
        save();
        return result('create');
      } catch (error) {
        // Deterministic IDs let a lost response or 409 reconcile without a second insert.
        const recovered = await readEvent(path);
        if (!recovered) throw error;
        remote = recovered;
        action = await actionFor(remote);
        if (action === 'skip') { save(); return result('create'); }
      }
    }
    if (action === 'skip') { save(); return result('skip'); }
    if (action !== 'update') return result(action, action === 'restore' ? 'Google event was deleted; restore requires review' : 'Calendar event changed or ownership could not be verified');
    if (!remote.etag) return result('review', 'Missing event version; update requires review');
    delete payload.id;
    payload.extendedProperties = { private: { ...remote.extendedProperties.private, ...properties } };
    try {
      await request(path + '?sendUpdates=none', jsonOptions('PATCH', payload, { 'If-Match': remote.etag }));
      save();
      return result('update');
    } catch (error) {
      if (error.status !== 412) throw error;
      await readEvent(path);
      return result('review', 'Calendar event changed during update');
    }
  }
  const api = { ensureCalendar, syncEvent };
  root.UmSpecCalendar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
