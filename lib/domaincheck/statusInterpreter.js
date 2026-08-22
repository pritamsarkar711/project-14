'use strict';

/*
 * EPP / RDAP domain status interpretation, grouped, explained in plain
 * language, deliberately non-alarming. Standard registrar/registry locks
 * (clientTransferProhibited …) are presented as Normal, not as problems.
 */

const STATUSES = {
  // Normal operational states
  'ok': { group: 'normal', label: 'OK', explanation: 'The domain has no pending operations or restrictions. This is the normal state.' },
  'active': { group: 'normal', label: 'Active', explanation: 'The domain is active in the registry.' },
  'clienttransferprohibited': { group: 'normal', label: 'Client transfer prohibited', explanation: 'The registrar has locked the domain against transfer to another registrar. This is a standard anti-hijacking setting, not a problem.' },
  'clientupdateprohibited': { group: 'normal', label: 'Client update prohibited', explanation: 'The registrar has locked the domain against modification. A standard registrar lock, not a problem.' },
  'clientdeleteprohibited': { group: 'normal', label: 'Client delete prohibited', explanation: 'The registrar has locked the domain against deletion. A standard registrar lock, not a problem.' },
  'clientrenewprohibited': { group: 'normal', label: 'Client renew prohibited', explanation: 'Renewal commands are blocked at the registrar level (often during disputes or transfers).' },
  'clienthold': { group: 'normal', label: 'Client hold', explanation: 'The registrar has placed the domain on hold, its DNS is typically suspended until the hold is lifted.' },
  'autorenewperiod': { group: 'normal', label: 'Auto-renew period', explanation: 'The domain is inside the post-expiration auto-renew grace window. Normal for recently renewed domains.' },

  // Transfer-related restrictions
  'servertransferprohibited': { group: 'transfer-restricted', label: 'Server transfer prohibited', explanation: 'The registry has locked the domain against registrar transfer. Often seen during disputes, legal holds, or at the registry’s discretion.' },
  'transferperiod': { group: 'transfer-restricted', label: 'Transfer period', explanation: 'The domain was recently transferred between registrars; further transfers are restricted during this grace period.' },
  'pendingtransfer': { group: 'transfer-restricted', label: 'Pending transfer', explanation: 'A registrar transfer has been requested and is being processed.' },

  // Update restrictions
  'serverupdateprohibited': { group: 'update-restricted', label: 'Server update prohibited', explanation: 'The registry has locked the domain against updates (often during disputes or court orders).' },
  'serverdeleteprohibited': { group: 'update-restricted', label: 'Server delete prohibited', explanation: 'The registry has locked the domain against deletion.' },
  'serverrenewprohibited': { group: 'update-restricted', label: 'Server renew prohibited', explanation: 'The registry has blocked renewal (often during disputes or legal holds).' },

  // Pending operations
  'pendingcreate': { group: 'pending', label: 'Pending create', explanation: 'The domain is being created and is not yet fully active.' },
  'pendingdelete': { group: 'pending', label: 'Pending delete', explanation: 'The domain has expired and is in the pending-delete phase. If not restored, it will be released.' },
  'pendingrenew': { group: 'pending', label: 'Pending renew', explanation: 'A renewal is being processed.' },
  'pendingrestore': { group: 'pending', label: 'Pending restore', explanation: 'A restoration from redemption is being processed.' },
  'pendingupdate': { group: 'pending', label: 'Pending update', explanation: 'An update operation is being processed.' },
  'addperiod': { group: 'pending', label: 'Add period', explanation: 'The domain is in the initial add grace period after registration.' },
  'renewperiod': { group: 'pending', label: 'Renew period', explanation: 'The domain is inside the post-renewal grace period.' },

  // Problem / attention
  'redemptionperiod': { group: 'problem', label: 'Redemption period', explanation: 'The domain has expired and entered redemption. The registrant can still restore it (usually for a fee).' },
  'serverhold': { group: 'problem', label: 'Server hold', explanation: 'The registry has suspended the domain, its DNS is typically disabled. Often due to abuse, disputes, or legal action.' },
  'inactive': { group: 'problem', label: 'Inactive', explanation: 'The domain has no active delegation (no nameservers) in the registry.' }
};

const UNKNOWN_GROUP = { group: 'normal', label: null, explanation: 'A registry-specific status code. Its exact meaning depends on the registry’s policy.' };

function interpret(code) {
  const key = String(code || '').toLowerCase().replace(/^\(|\)$/g, '').trim();
  const s = STATUSES[key];
  if (!s) return { code: code, group: 'normal', label: key || String(code), explanation: UNKNOWN_GROUP.explanation, known: false };
  return { code: code, group: s.group, label: s.label, explanation: s.explanation, known: true };
}

function groupStatuses(codes) {
  const groups = { normal: [], 'transfer-restricted': [], 'update-restricted': [], pending: [], problem: [] };
  for (const c of codes || []) {
    const i = interpret(c);
    groups[i.group].push(i);
  }
  return groups;
}

module.exports = { interpret, groupStatuses, STATUSES };
