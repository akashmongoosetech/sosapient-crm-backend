/**
 * Pure duplicate-detection helpers (no DB access — unit-testable).
 *
 * Matching hierarchy (first non-empty identifier wins per record):
 *   1. exact non-empty placeId
 *   2. exact non-empty phoneUnformatted (digit-normalized)
 *   3. exact non-empty phone (digit-normalized)
 *   4. website hostname normalized (protocol/ww/trailing-slash/case insensitive)
 *   5. fallback: normalized title + address combination
 * Empty/missing identifiers NEVER match.
 */

function normText(v) {
  if (v === null || v === undefined) return '';
  return String(v).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Keep digits only; drop formatting, spaces, '+' prefixes. Meaningful digits survive.
function normPhone(v) {
  if (v === null || v === undefined) return '';
  const digits = String(v).replace(/\D/g, '');
  return digits.length >= 4 ? digits : '';
}

function normSite(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).trim().toLowerCase();
  if (!s) return '';
  if (!s.includes('://')) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    let host = u.hostname.replace(/^www\./, '');
    if (!host.includes('.')) return '';
    return host;
  } catch {
    return '';
  }
}

/**
 * Extract the single duplicate-detection key for a record.
 * Returns { kind, value } or null when the record has no usable identifier.
 */
function extractKey(core) {
  const placeId = String(core.placeId || '').trim();
  if (placeId) return { kind: 'placeId', value: placeId };
  const pu = normPhone(core.phoneUnformatted);
  if (pu) return { kind: 'phoneUnformatted', value: pu };
  const ph = normPhone(core.phone);
  if (ph) return { kind: 'phone', value: ph };
  const site = normSite(core.website);
  if (site) return { kind: 'website', value: site };
  const title = normText(core.title);
  const addr = normText(core.address);
  if (title && addr) return { kind: 'titleAddress', value: `${title}||${addr}` };
  return null;
}

module.exports = { normText, normPhone, normSite, extractKey };
