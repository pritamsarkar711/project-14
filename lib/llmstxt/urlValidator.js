'use strict';

/*
 * LLMs.txt Generator — input URL validation.
 * Normalises user input and enforces SSRF-safe public-URL rules.
 */

const { makeError, normalizeInputUrl } = require('../wptheme/util');
const { assertPublicUrl, resolvePublic } = require('../wptheme/ssrf');

async function validateUrl(raw) {
  const u = normalizeInputUrl(raw); // throws invalid_url / credential / hostname errors
  assertPublicUrl(u.toString());
  await resolvePublic(u.hostname); // DNS resolution + private-IP rebinding guard
  u.hash = '';
  return u;
}

module.exports = { validateUrl, makeError };
