'use strict';
const { normalizeInputUrl, makeError } = require('../wptheme/util');
const { assertPublicUrl, resolvePublic } = require('../wptheme/ssrf');
async function validateUrl(raw) {
  const u = normalizeInputUrl(raw);
  assertPublicUrl(u.toString());
  await resolvePublic(u.hostname);
  u.hash = '';
  return u;
}
module.exports = { validateUrl, makeError };
