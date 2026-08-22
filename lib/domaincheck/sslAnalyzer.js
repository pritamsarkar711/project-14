'use strict';

/*
 * SSL/TLS analysis (production transport; needs direct TLS egress).
 *
 * Passively connects once to port 443 and reads the presented certificate —
 * exactly what any TLS client sees. No intrusive testing: legacy-version
 * probes only attempt a handshake and never send application data. When the
 * environment cannot reach TLS endpoints (e.g. this preview sandbox), the
 * outcome is 'unavailable' with the reason — never a guessed certificate.
 */

const tls = require('tls');
const net = require('net');
const U = require('./util');

const TIMEOUT_MS = 9000;

function matchHostname(hostname, cert) {
  const names = [];
  if (cert && cert.subject) {
    const cn = cert.subject.CN;
    if (cn) names.push(cn);
  }
  if (cert && cert.subjectaltname) {
    names.push(...String(cert.subjectaltname).split(',').map(s => s.trim().replace(/^DNS:/i, '')));
  }
  const h = String(hostname).toLowerCase();
  return names.some(n => {
    const name = n.toLowerCase();
    if (name === h) return true;
    if (name.startsWith('*.')) {
      const suffix = name.slice(1);
      return h.endsWith(suffix) && !h.slice(0, -suffix.length).includes('.');
    }
    return false;
  });
}

function connectOnce(host, port, opt) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const sock = tls.connect({
      host, port,
      servername: host,
      rejectUnauthorized: false, // we inspect the chain ourselves and report it
      timeout: opt.timeout || TIMEOUT_MS,
      minVersion: opt.minVersion,
      maxVersion: opt.maxVersion
    }, () => {
      const info = {
        protocol: sock.getProtocol ? sock.getProtocol() : null,
        authorized: sock.authorized || false,
        authorizationError: sock.authorizationError || null,
        cert: sock.getPeerCertificate ? sock.getPeerCertificate() : null,
        cipher: sock.getCipher ? sock.getCipher() : null,
        ms: Date.now() - t0
      };
      sock.end();
      resolve(info);
    });
    sock.on('error', e => {
      const c = String(e.code || '');
      const m = String(e.message || '');
      if (opt.weakProbe) {
        // legacy handshake rejected → that legacy version is not accepted
        resolve({ protocol: null, authorized: false, authorizationError: c + ' ' + m, cert: null, cipher: null, ms: Date.now() - t0, rejected: true });
        return;
      }
      if (/ECONNRESET|EPIPE|EPROTO|ERR_SSL_WRONG_VERSION|handshake|socket disconnected/i.test(c + ' ' + m)) {
        reject(U.makeError('tls_blocked', 'The TLS connection was reset during the handshake — either the server refuses this scanner or this environment has no direct TLS egress.', e));
      } else if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(c)) {
        reject(U.makeError('unreachable', 'Port 443 connection refused or unreachable.', e));
      } else {
        reject(U.makeError('tls_error', 'TLS connection failed: ' + m, e));
      }
    });
    sock.setTimeout(opt.timeout || TIMEOUT_MS, () => { sock.destroy(); reject(U.makeError('timeout', 'TLS handshake timed out.')); });
  });
}

function certDaysRemaining(validTo) {
  const d = U.parseDateLoose(validTo);
  if (!d) return null;
  return Math.floor((d.date.getTime() - Date.now()) / 86400000);
}

function analyzeCert(host, info) {
  const cert = info.cert || null;
  const out = {
    status: 'unavailable',
    connected: !!info.protocol,
    tlsVersion: info.protocol || null,
    chainValid: info.authorized,
    chainError: info.authorizationError || null,
    issuer: null,
    subject: null,
    validFrom: null,
    validUntil: null,
    daysRemaining: null,
    certType: null,
    sanDomains: [],
    serialNumber: null,
    hostnameMatches: null,
    expired: null,
    notYetValid: null,
    source: 'tls',
    note: null
  };
  if (!cert || !cert.raw) {
    if (info.rejected) return out;
    out.status = 'not-detected';
    out.note = 'A TLS connection was made but no certificate was presented.';
    return out;
  }
  const issuerO = cert.issuer && cert.issuer.O ? cert.issuer.O : null;
  const issuerCN = cert.issuer && cert.issuer.CN ? cert.issuer.CN : null;
  out.issuer = issuerO || issuerCN || 'Unknown issuer';
  out.issuerCommonName = issuerCN || null;
  out.issuerOrganization = issuerO || null;
  out.subject = cert.subject && cert.subject.CN ? cert.subject.CN : null;
  out.validFrom = cert.valid_from || null;
  out.validUntil = cert.valid_to || null;
  out.serialNumber = cert.serialNumber || null;
  const san = cert.subjectaltname ? String(cert.subjectaltname).split(',').map(s => s.trim().replace(/^DNS:/i, '')).filter(Boolean) : [];
  out.sanDomains = san.slice(0, 40);
  out.hostnameMatches = matchHostname(host, cert);
  const pk = String(cert.pubkey ? cert.pubkey.type || '' : '');
  out.certType = pk ? (pk.includes('EC') ? 'EC (elliptic curve)' : pk.includes('RSA') ? 'RSA' : pk) : null;
  const dFrom = U.parseDateLoose(cert.valid_from);
  const dTo = U.parseDateLoose(cert.valid_to);
  out.daysRemaining = certDaysRemaining(cert.valid_to);
  const now = Date.now();
  if (dTo && dTo.date.getTime() < now) out.expired = true;
  else if (dFrom && dFrom.date.getTime() > now) out.notYetValid = true;
  else out.expired = false;

  if (out.expired) {
    out.status = 'expired';
    out.note = 'The certificate has expired' + (out.daysRemaining != null ? ' (' + Math.abs(out.daysRemaining) + ' days ago)' : '') + '.';
  } else if (out.notYetValid) {
    out.status = 'invalid';
    out.note = 'The certificate is not yet valid.';
  } else if (!out.hostnameMatches) {
    out.status = 'invalid';
    out.note = 'The certificate does not cover the hostname ' + host + ' (subject/SAN mismatch).';
  } else if (!info.authorized) {
    out.status = 'invalid';
    out.note = 'The certificate chain could not be validated: ' + (out.chainError || 'unknown chain error') + '.';
  } else {
    out.status = 'valid';
  }
  return out;
}

async function analyzeSsl(host, opt) {
  opt = opt || {};
  const transport = opt.transport || null; // injectable: async (host, opt) => tls info
  let info;
  try {
    info = transport ? await transport(host, opt) : await connectOnce(host, 443, opt);
  } catch (e) {
    return {
      status: 'unavailable', source: 'tls', reason: e.code || 'tls_error',
      note: (e.code === 'tls_blocked' || e.code === 'timeout' || e.code === 'unreachable')
        ? 'HTTPS/TLS could not be reached from this environment, so the certificate could not be inspected.'
        : 'TLS inspection failed: ' + e.message,
      signals: []
    };
  }
  const cert = analyzeCert(host, info);

  // Security signals (non-intrusive)
  const signals = [];
  signals.push({
    name: 'certificate-valid', status: cert.status === 'valid' ? 'ok' : (cert.status === 'expired' ? 'fail' : cert.status === 'invalid' ? 'warn' : 'unknown'),
    detail: cert.status === 'valid' ? 'Certificate is currently valid and covers the hostname.' : (cert.note || '')
  });
  signals.push({
    name: 'chain', status: info.authorized ? 'ok' : 'warn',
    detail: info.authorized ? 'The certificate chain validated to a trusted root.' : 'Chain validation failed: ' + (info.authorizationError || 'unknown')
  });
  if (info.protocol) {
    const modern = /TLSv1\.3|TLSv1\.2/i.test(info.protocol);
    signals.push({ name: 'tls-version', status: modern ? 'ok' : 'warn', detail: 'Negotiated ' + info.protocol });
  }
  if (cert.expired) signals.push({ name: 'expired', status: 'fail', detail: 'Certificate expired.' });
  if (cert.daysRemaining != null && cert.daysRemaining >= 0) {
    if (cert.daysRemaining <= 7) signals.push({ name: 'expiry-soon', status: 'warn', detail: 'Certificate expires within 7 days.' });
    else if (cert.daysRemaining <= 30) signals.push({ name: 'expiry-soon', status: 'info', detail: 'Certificate expires within 30 days.' });
  }

  // Weak TLS detection uses handshake only probes. They are independent, so
  // run them together rather than adding one full timeout after the other.
  const weakResults = await Promise.all(['TLSv1', 'TLSv1.1'].map(async version => {
    try {
      return transport ? await transport(host, { weakProbe: true, minVersion: version, maxVersion: version }) : await connectOnce(host, 443, { weakProbe: true, minVersion: version, maxVersion: version });
    } catch (e) { return null; }
  }));
  const weakAccepted = weakResults.filter(probe => probe && probe.protocol).map(probe => probe.protocol);
  if (weakAccepted.length) {
    signals.push({ name: 'weak-tls', status: 'warn', detail: 'Server accepted legacy ' + weakAccepted.join(', ') + ' handshakes (handshake-only probe, no data sent).' });
  }

  return {
    status: cert.status, source: 'tls', reason: null, note: cert.note,
    tlsVersion: cert.tlsVersion, issuer: cert.issuer, issuerOrganization: cert.issuerOrganization,
    subject: cert.subject, validFrom: cert.validFrom, validUntil: cert.validUntil,
    daysRemaining: cert.daysRemaining, certType: cert.certType, sanDomains: cert.sanDomains,
    chainValid: cert.chainValid, chainError: cert.chainError,
    hostnameMatches: cert.hostnameMatches, serialNumber: cert.serialNumber,
    expired: cert.expired, signals
  };
}

module.exports = { analyzeSsl, analyzeCert, connectOnce, certDaysRemaining, matchHostname };
