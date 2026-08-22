'use strict';

/*
 * Core Web Vitals & INP Auditor, scan sessions.
 *
 * A scan session holds, for one URL/profile run:
 *   - the rewritten page HTML served to the measurement iframe
 *   - transport evidence for the document (headers, phases, protocol)
 *   - metadata recorded for every proxied subresource (status, cache
 *     headers, content-encoding, protocol, timing), used later by the
 *     caching / compression / protocol audits
 *
 * Nothing is persisted to disk. Sessions expire (TTL) and are capped so a
 * long-lived server cannot accumulate unbounded memory. Resource metadata
 * is capped per session and per resource.
 */

const crypto = require('crypto');

const TTL_MS = 12 * 60 * 1000;
const MAX_SESSIONS = 40;
const MAX_RESOURCES = 350;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const HEADER_KEYS = ['cache-control', 'expires', 'etag', 'last-modified', 'age', 'vary', 'content-encoding', 'content-type', 'content-length', 'server', 'via', 'cf-cache-status', 'x-cache', 'timing-allow-origin'];

const sessions = new Map();

function sweep() {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (now - s.created > TTL_MS) sessions.delete(sid);
  }
  while (sessions.size > MAX_SESSIONS) {
    let oldestId = null, oldestAt = Infinity;
    for (const [sid, s] of sessions) { if (s.created < oldestAt) { oldestAt = s.created; oldestId = sid; } }
    if (oldestId) sessions.delete(oldestId);
    else break;
  }
}

function createSession(meta) {
  sweep();
  const sid = crypto.randomBytes(12).toString('hex');
  const s = {
    sid,
    created: Date.now(),
    url: meta.url,
    finalUrl: meta.finalUrl,
    html: meta.html,                      // rewritten page HTML (cached for /api/cwv-page)
    docHeaders: meta.docHeaders || {},
    docPhases: meta.docPhases || null,
    docProtocol: meta.docProtocol || null,
    docIp: meta.docIp || null,
    docRedirects: meta.docRedirects || [],
    docStatus: meta.docStatus || 0,
    docBytes: meta.docBytes != null ? meta.docBytes : null,
    docTruncated: !!meta.docTruncated,
    transportMode: meta.transportMode || 'direct',
    viaRelay: meta.viaRelay || null,
    profile: meta.profile || null,
    resources: new Map(),                 // url → meta
    totalBytes: 0,
    notes: []
  };
  sessions.set(sid, s);
  return s;
}

function getSession(sid) {
  sweep();
  return sessions.get(sid) || null;
}

function recordResource(sid, meta) {
  const s = getSession(sid);
  if (!s) return false;
  if (s.resources.size >= MAX_RESOURCES || s.totalBytes >= MAX_TOTAL_BYTES) return false;
  const key = meta.url || '';
  if (!key) return false;
  const headers = {};
  for (const k of HEADER_KEYS) {
    if (meta.headers && meta.headers[k] != null) headers[k] = String(meta.headers[k]).slice(0, 600);
  }
  s.resources.set(key, {
    url: key,
    status: meta.status || 0,
    headers,
    contentType: meta.contentType || (meta.headers && meta.headers['content-type']) || '',
    protocol: meta.protocol || null,
    ttfbMs: meta.ttfbMs != null ? meta.ttfbMs : null,
    totalMs: meta.totalMs != null ? meta.totalMs : null,
    bytes: meta.bytes != null ? meta.bytes : null,
    truncated: !!meta.truncated,
    error: meta.error || null
  });
  s.totalBytes += (meta.bytes || 0);
  return true;
}

function sessionMeta(sid) {
  const s = getSession(sid);
  if (!s) return null;
  return {
    sid,
    url: s.url,
    finalUrl: s.finalUrl,
    docStatus: s.docStatus,
    docHeaders: s.docHeaders,
    docPhases: s.docPhases,
    docProtocol: s.docProtocol,
    docIp: s.docIp,
    docBytes: s.docBytes,
    docTruncated: s.docTruncated,
    transportMode: s.transportMode || 'direct',
    viaRelay: s.viaRelay || null,
    docRedirects: s.docRedirects,
    profile: s.profile,
    resources: Array.from(s.resources.values()),
    resourceCount: s.resources.size,
    totalBytes: s.totalBytes,
    notes: s.notes
  };
}

module.exports = { createSession, getSession, recordResource, sessionMeta };
