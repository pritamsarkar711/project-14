'use strict';

/**
 * SSL/TLS Analysis Module
 * Detects:
 * - expired certificate
 * - hostname mismatch
 * - invalid certificate
 * - TLS handshake failure
 * - unsupported TLS configuration
 */

const tls = require('tls');
const { URL } = require('url');

function makeError(code, message, meta) {
  const e = new Error(message);
  e.code = code;
  if (meta) Object.assign(e, meta);
  return e;
}

function checkTls(hostname, port = 443, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: hostname,
      port,
      servername: hostname,
      rejectUnauthorized: false, // we want to inspect even invalid certs
      timeout: timeoutMs
    }, () => {
      const cert = socket.getPeerCertificate(true);
      const authorized = socket.authorized;
      const authError = socket.authorizationError;

      const now = new Date();
      let validFrom = null, validTo = null;
      try {
        if (cert && cert.valid_from) validFrom = new Date(cert.valid_from);
        if (cert && cert.valid_to) validTo = new Date(cert.valid_to);
      } catch {}

      let status = 'valid';
      let reason = null;

      if (!cert || Object.keys(cert).length === 0) {
        status = 'invalid';
        reason = 'No certificate presented';
      } else if (!authorized) {
        // Map authorization errors
        if (authError && /certificate has expired/i.test(authError)) {
          status = 'expired';
          reason = `Certificate expired: ${authError}`;
        } else if (authError && /hostname mismatch|does not match/i.test(authError)) {
          status = 'hostname_mismatch';
          reason = `Hostname mismatch: ${authError}`;
        } else {
          status = 'invalid';
          reason = authError || 'Invalid certificate';
        }
      } else if (validTo && validTo < now) {
        status = 'expired';
        reason = `Certificate expired on ${validTo.toISOString()}`;
      } else if (validFrom && validFrom > now) {
        status = 'not_yet_valid';
        reason = `Certificate not valid before ${validFrom.toISOString()}`;
      }

      const result = {
        ok: status === 'valid',
        status,
        reason,
        authorized,
        authError,
        cert: cert ? {
          subject: cert.subject,
          issuer: cert.issuer,
          valid_from: cert.valid_from,
          valid_to: cert.valid_to,
          fingerprint: cert.fingerprint,
          serialNumber: cert.serialNumber,
          subjectaltname: cert.subjectaltname
        } : null,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher()
      };
      socket.end();
      resolve(result);
    });

    socket.on('error', (err) => {
      let status = 'handshake_failed';
      const msg = err.message || String(err);
      if (/certificate has expired/i.test(msg)) status = 'expired';
      else if (/hostname|altname/i.test(msg)) status = 'hostname_mismatch';
      else if (/self signed|unable to verify|invalid/i.test(msg)) status = 'invalid';
      else if (/unsupported|protocol/i.test(msg)) status = 'unsupported';
      resolve({
        ok: false,
        status,
        reason: msg,
        error: msg,
        cert: null,
        protocol: null,
        cipher: null
      });
    });

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({
        ok: false,
        status: 'timeout',
        reason: 'TLS handshake timeout',
        error: 'TLS timeout',
        cert: null
      });
    });
  });
}

function classifyTlsError(error) {
  const msg = String(error.message || error || '').toLowerCase();
  if (msg.includes('expired')) return { type: 'expired', label: 'SSL/TLS Error: expired certificate' };
  if (msg.includes('hostname') || msg.includes('altname') || msg.includes('mismatch')) return { type: 'hostname_mismatch', label: 'SSL/TLS Error: hostname mismatch' };
  if (msg.includes('self signed') || msg.includes('unable to verify') || msg.includes('invalid certificate')) return { type: 'invalid', label: 'SSL/TLS Error: invalid certificate' };
  if (msg.includes('handshake') || msg.includes('tls') || msg.includes('ssl')) return { type: 'handshake_failed', label: 'SSL/TLS Error: TLS handshake failure' };
  return { type: 'tls_error', label: `SSL/TLS Error: ${error.message || 'TLS error'}` };
}

module.exports = { checkTls, classifyTlsError };
