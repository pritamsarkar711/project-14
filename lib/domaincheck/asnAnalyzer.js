'use strict';

/*
 * IP → ASN / network-organization intelligence.
 *
 * Sources (in order of strength, all labelled):
 *   1. Team Cymru's public DNS service (origin.asn.cymru.com), live ASN,
 *      announced prefix, country and registry for an IP. Public data, DNS-only.
 *   2. Local CIDR fingerprint database, curated ranges of major CDN, cloud
 *      and hosting networks (used to name providers precisely and to resolve
 *      edge cases where BGP prefix data is coarse).
 *   3. RDAP (IP → network object), production only.
 *
 * Disagreements between sources are surfaced as conflicts, never silently
 * merged.
 */

const U = require('./util');

/* ASN → provider display name (well-known, stable mappings). */
const ASN_NAMES = {
  13335: { name: 'Cloudflare', kind: 'cdn' },
  16509: { name: 'Amazon.com (AWS)', kind: 'cloud' },
  14618: { name: 'Amazon Web Services', kind: 'cloud' },
  39111: { name: 'Amazon Web Services', kind: 'cloud' },
  15169: { name: 'Google', kind: 'cloud' },
  396982: { name: 'Google Cloud', kind: 'cloud' },
  36384: { name: 'Google', kind: 'cloud' },
  8075: { name: 'Microsoft (Azure)', kind: 'cloud' },
  8068: { name: 'Microsoft', kind: 'cloud' },
  8069: { name: 'Microsoft', kind: 'cloud' },
  8070: { name: 'Microsoft', kind: 'cloud' },
  8071: { name: 'Microsoft', kind: 'cloud' },
  8072: { name: 'Microsoft', kind: 'cloud' },
  8073: { name: 'Microsoft', kind: 'cloud' },
  8074: { name: 'Microsoft', kind: 'cloud' },
  14061: { name: 'DigitalOcean', kind: 'host' },
  16276: { name: 'OVH', kind: 'host' },
  35540: { name: 'OVH', kind: 'host' },
  24940: { name: 'Hetzner Online', kind: 'host' },
  213230: { name: 'Hetzner Online', kind: 'host' },
  51167: { name: 'Contabo', kind: 'host' },
  40021: { name: 'Contabo (Nubes)', kind: 'host' },
  47583: { name: 'Hostinger', kind: 'host' },
  46606: { name: 'Unified Layer (Newfold: Bluehost/HostGator)', kind: 'host' },
  19871: { name: 'Network Solutions (Newfold)', kind: 'host' },
  26496: { name: 'GoDaddy', kind: 'host' },
  398101: { name: 'GoDaddy', kind: 'host' },
  22612: { name: 'Namecheap', kind: 'host' },
  55293: { name: 'A2 Hosting', kind: 'host' },
  32244: { name: 'Liquid Web', kind: 'host' },
  15395: { name: 'Rackspace', kind: 'host' },
  19994: { name: 'Rackspace', kind: 'host' },
  27357: { name: 'Rackspace', kind: 'host' },
  33070: { name: 'Rackspace', kind: 'host' },
  8560: { name: 'IONOS', kind: 'host' },
  36351: { name: 'SoftLayer (IBM Cloud)', kind: 'host' },
  16265: { name: 'Leaseweb', kind: 'host' },
  60781: { name: 'Leaseweb', kind: 'host' },
  28753: { name: 'Leaseweb', kind: 'host' },
  30633: { name: 'Leaseweb', kind: 'host' },
  8100: { name: 'QuadraNet', kind: 'host' },
  18779: { name: 'EGIHosting', kind: 'host' },
  18978: { name: 'Enzu', kind: 'host' },
  35916: { name: 'Multacom', kind: 'host' },
  23470: { name: 'ReliableSite', kind: 'host' },
  49981: { name: 'WorldStream', kind: 'host' },
  20326: { name: 'Teraswitch', kind: 'host' },
  46844: { name: 'Sharktech', kind: 'host' },
  40676: { name: 'Psychz Networks', kind: 'host' },
  13768: { name: 'Peer1 (Cogeco)', kind: 'host' },
  9009: { name: 'M247', kind: 'host' },
  13213: { name: 'UK2 Group', kind: 'host' },
  20473: { name: 'Choopa (Vultr)', kind: 'host' },
  54825: { name: 'Equinix Metal (Packet)', kind: 'host' },
  197540: { name: 'Netcup', kind: 'host' },
  197071: { name: 'ActiveServers', kind: 'host' },
  54113: { name: 'Fastly', kind: 'cdn' },
  20940: { name: 'Akamai Technologies', kind: 'cdn' },
  12222: { name: 'Akamai Technologies', kind: 'cdn' },
  16625: { name: 'Akamai (GHS Edge)', kind: 'cdn' },
  32787: { name: 'Akamai (Prolexic)', kind: 'cdn' },
  63949: { name: 'Akamai (Linode)', kind: 'host' },
  30148: { name: 'Sucuri', kind: 'cdn' },
  19551: { name: 'Imperva (Incapsula)', kind: 'cdn' },
  57724: { name: 'DDoS-Guard', kind: 'cdn' },
  199524: { name: 'Gcore', kind: 'cdn' },
  60068: { name: 'Bunny CDN (DataCamp)', kind: 'cdn' },
  212238: { name: 'Bunny CDN (DataCamp)', kind: 'cdn' },
  33438: { name: 'StackPath (Highwinds)', kind: 'cdn' },
  20446: { name: 'Highwinds (StackPath)', kind: 'cdn' },
  53831: { name: 'Squarespace', kind: 'host' },
  27647: { name: 'Weebly (Square)', kind: 'host' },
  58182: { name: 'Wix', kind: 'host' },
  2635: { name: 'Automattic (WordPress.com)', kind: 'host' },
  26347: { name: 'New Dream Network (DreamHost)', kind: 'host' },
  36459: { name: 'GitHub', kind: 'host' },
  62597: { name: 'Vercel', kind: 'host' },
  32934: { name: 'Meta (Facebook)', kind: 'cloud' },
  714: { name: 'Apple', kind: 'cloud' },
  6939: { name: 'Hurricane Electric', kind: 'isp' },
  6461: { name: 'Zayo', kind: 'isp' },
  1299: { name: 'Arelion (Telia)', kind: 'isp' },
  3320: { name: 'Deutsche Telekom', kind: 'isp' },
  3215: { name: 'Orange', kind: 'isp' },
  6830: { name: 'Liberty Global', kind: 'isp' },
  2856: { name: 'BT', kind: 'isp' },
  5089: { name: 'Virgin Media', kind: 'isp' },
  786: { name: 'Jisc', kind: 'isp' },
  12322: { name: 'Free (Iliad)', kind: 'isp' },
  15557: { name: 'SFR', kind: 'isp' },
  5410: { name: 'Bouygues Telecom', kind: 'isp' },
  3209: { name: 'Vodafone', kind: 'isp' },
  9121: { name: 'Türk Telekom', kind: 'isp' },
  3491: { name: 'PCCW Global', kind: 'isp' },
  7473: { name: 'SingTel', kind: 'isp' },
  4775: { name: 'Globe Telecom', kind: 'isp' },
  9299: { name: 'PLDT', kind: 'isp' },
  4788: { name: 'TM Net (Malaysia)', kind: 'isp' },
  4766: { name: 'Korea Telecom', kind: 'isp' },
  3786: { name: 'LG DACOM', kind: 'isp' },
  9318: { name: 'SK Broadband', kind: 'isp' },
  3462: { name: 'HiNet (Chunghwa)', kind: 'isp' },
  4134: { name: 'China Telecom', kind: 'isp' },
  4837: { name: 'China Unicom', kind: 'isp' },
  9808: { name: 'China Mobile', kind: 'isp' },
  132203: { name: 'Tencent Cloud', kind: 'cloud' },
  37963: { name: 'Alibaba Cloud', kind: 'cloud' },
  45102: { name: 'Alibaba Cloud', kind: 'cloud' },
  7018: { name: 'AT&T', kind: 'isp' },
  702: { name: 'Verizon Business', kind: 'isp' },
  701: { name: 'Verizon Business', kind: 'isp' },
  7922: { name: 'Comcast', kind: 'isp' },
  20115: { name: 'Charter (Spectrum)', kind: 'isp' },
  10796: { name: 'Charter (Spectrum)', kind: 'isp' },
  33491: { name: 'Comcast Business', kind: 'isp' },
  22394: { name: 'Verizon Wireless', kind: 'isp' },
  6167: { name: 'Verizon Wireless', kind: 'isp' },
  10507: { name: 'Sprint', kind: 'isp' },
  174: { name: 'Cogent', kind: 'isp' },
  3257: { name: 'GTT', kind: 'isp' },
  6453: { name: 'TATA Communications', kind: 'isp' },
  3356: { name: 'Lumen (Level 3)', kind: 'isp' },
  3549: { name: 'Lumen (Global)', kind: 'isp' },
  2914: { name: 'NTT', kind: 'isp' },
  2497: { name: 'IIJ', kind: 'isp' },
  4713: { name: 'OCN (NTT)', kind: 'isp' },
  2516: { name: 'KDDI', kind: 'isp' },
  17676: { name: 'SoftBank', kind: 'isp' }
};

/* CIDR → provider (well-known published ranges, curated). */
function ip4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

const CIDRS = [];
function cidr(prefix, name, kind, asn) {
  const [base, len] = prefix.split('/');
  const baseInt = ip4ToInt(base);
  if (baseInt == null) return;
  const mask = len >= 32 ? 0xffffffff : ((0xffffffff << (32 - len)) >>> 0);
  CIDRS.push({ base: baseInt & mask, mask, len: Number(len), name, kind, asn, prefix });
}

/* CDN edge networks */
cidr('104.16.0.0/13', 'Cloudflare', 'cdn', 13335);
cidr('104.24.0.0/14', 'Cloudflare', 'cdn', 13335);
cidr('172.64.0.0/13', 'Cloudflare', 'cdn', 13335);
cidr('131.0.72.0/22', 'Cloudflare', 'cdn', 13335);
cidr('141.101.64.0/18', 'Cloudflare', 'cdn', 13335);
cidr('162.158.0.0/15', 'Cloudflare', 'cdn', 13335);
cidr('173.245.48.0/20', 'Cloudflare', 'cdn', 13335);
cidr('188.114.96.0/20', 'Cloudflare', 'cdn', 13335);
cidr('190.93.240.0/20', 'Cloudflare', 'cdn', 13335);
cidr('197.234.240.0/22', 'Cloudflare', 'cdn', 13335);
cidr('198.41.128.0/17', 'Cloudflare', 'cdn', 13335);
cidr('103.21.244.0/22', 'Cloudflare', 'cdn', 13335);
cidr('103.22.200.0/22', 'Cloudflare', 'cdn', 13335);
cidr('103.31.4.0/22', 'Cloudflare', 'cdn', 13335);
cidr('151.101.0.0/16', 'Fastly', 'cdn', 54113);
cidr('199.232.0.0/16', 'Fastly', 'cdn', 54113);
cidr('23.235.32.0/20', 'Fastly', 'cdn', 54113);
cidr('146.75.0.0/17', 'Fastly', 'cdn', 54113);
cidr('157.52.64.0/18', 'Fastly', 'cdn', 54113);
cidr('167.82.0.0/17', 'Fastly', 'cdn', 54113);
cidr('185.199.108.0/22', 'Fastly (GitHub Pages)', 'cdn', 54113);
cidr('185.199.109.0/22', 'Fastly (GitHub Pages)', 'cdn', 54113);
cidr('185.199.110.0/22', 'Fastly (GitHub Pages)', 'cdn', 54113);
cidr('185.199.111.0/22', 'Fastly (GitHub Pages)', 'cdn', 54113);
cidr('13.32.0.0/15', 'Amazon CloudFront', 'cdn', 16509);
cidr('13.224.0.0/14', 'Amazon CloudFront', 'cdn', 16509);
cidr('13.226.0.0/15', 'Amazon CloudFront', 'cdn', 16509);
cidr('52.84.0.0/15', 'Amazon CloudFront', 'cdn', 16509);
cidr('54.182.0.0/16', 'Amazon CloudFront', 'cdn', 16509);
cidr('54.192.0.0/16', 'Amazon CloudFront', 'cdn', 16509);
cidr('54.230.0.0/16', 'Amazon CloudFront', 'cdn', 16509);
cidr('54.239.128.0/18', 'Amazon CloudFront', 'cdn', 16509);
cidr('54.240.128.0/18', 'Amazon CloudFront', 'cdn', 16509);
cidr('64.252.64.0/18', 'Amazon CloudFront', 'cdn', 16509);
cidr('64.252.128.0/18', 'Amazon CloudFront', 'cdn', 16509);
cidr('99.84.0.0/16', 'Amazon CloudFront', 'cdn', 16509);
cidr('143.204.0.0/16', 'Amazon CloudFront', 'cdn', 16509);
cidr('204.246.164.0/22', 'Amazon CloudFront', 'cdn', 16509);
cidr('204.246.168.0/22', 'Amazon CloudFront', 'cdn', 16509);
cidr('204.246.174.0/23', 'Amazon CloudFront', 'cdn', 16509);
cidr('204.246.176.0/20', 'Amazon CloudFront', 'cdn', 16509);
cidr('205.251.192.0/19', 'Amazon CloudFront', 'cdn', 16509);
cidr('216.137.32.0/19', 'Amazon CloudFront', 'cdn', 16509);
cidr('23.32.0.0/11', 'Akamai', 'cdn', 20940);
cidr('23.64.0.0/14', 'Akamai', 'cdn', 20940);
cidr('23.192.0.0/11', 'Akamai', 'cdn', 20940);
cidr('96.16.0.0/15', 'Akamai', 'cdn', 20940);
cidr('104.64.0.0/10', 'Akamai', 'cdn', 20940);
cidr('184.84.0.0/14', 'Akamai', 'cdn', 20940);
cidr('72.246.0.0/15', 'Akamai', 'cdn', 20940);
cidr('88.221.0.0/16', 'Akamai', 'cdn', 20940);
cidr('169.150.196.0/22', 'Bunny CDN', 'cdn', 60068);
cidr('138.199.16.0/20', 'Bunny CDN', 'cdn', 60068);
cidr('192.124.249.0/24', 'Sucuri', 'cdn', 30148);
cidr('45.60.0.0/16', 'Imperva (Incapsula)', 'cdn', 19551);
cidr('107.154.0.0/16', 'Imperva (Incapsula)', 'cdn', 19551);
cidr('103.28.248.0/22', 'Imperva (Incapsula)', 'cdn', 19551);
cidr('92.223.0.0/16', 'Gcore', 'cdn', 199524);

/* Cloud / hosting networks */
cidr('34.64.0.0/10', 'Google Cloud', 'cloud', 396982);
cidr('35.192.0.0/11', 'Google Cloud', 'cloud', 396982);
cidr('13.64.0.0/11', 'Microsoft Azure', 'cloud', 8075);
cidr('13.104.0.0/14', 'Microsoft Azure', 'cloud', 8075);
cidr('20.36.0.0/14', 'Microsoft Azure', 'cloud', 8075);
cidr('40.64.0.0/10', 'Microsoft Azure', 'cloud', 8075);
cidr('104.131.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('159.65.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('159.203.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('138.197.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('142.93.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('143.198.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('157.230.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('159.89.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('165.227.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('167.71.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('167.99.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('68.183.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('104.236.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('104.248.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('64.225.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('64.226.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('64.227.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('45.55.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('139.59.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('206.189.0.0/16', 'DigitalOcean', 'host', 14061);
cidr('198.199.64.0/18', 'DigitalOcean', 'host', 14061);
cidr('51.38.0.0/16', 'OVH', 'host', 16276);
cidr('51.68.0.0/16', 'OVH', 'host', 16276);
cidr('51.75.0.0/16', 'OVH', 'host', 16276);
cidr('51.77.0.0/16', 'OVH', 'host', 16276);
cidr('51.83.0.0/16', 'OVH', 'host', 16276);
cidr('51.89.0.0/16', 'OVH', 'host', 16276);
cidr('51.91.0.0/16', 'OVH', 'host', 16276);
cidr('54.36.0.0/16', 'OVH', 'host', 16276);
cidr('54.37.0.0/16', 'OVH', 'host', 16276);
cidr('54.38.0.0/16', 'OVH', 'host', 16276);
cidr('54.39.0.0/16', 'OVH', 'host', 16276);
cidr('91.121.0.0/16', 'OVH', 'host', 16276);
cidr('92.222.0.0/16', 'OVH', 'host', 16276);
cidr('94.23.0.0/16', 'OVH', 'host', 16276);
cidr('137.74.0.0/16', 'OVH', 'host', 16276);
cidr('139.99.0.0/16', 'OVH', 'host', 16276);
cidr('141.94.0.0/16', 'OVH', 'host', 16276);
cidr('141.95.0.0/16', 'OVH', 'host', 16276);
cidr('142.44.0.0/16', 'OVH', 'host', 16276);
cidr('145.239.0.0/16', 'OVH', 'host', 16276);
cidr('146.59.0.0/16', 'OVH', 'host', 16276);
cidr('151.80.0.0/16', 'OVH', 'host', 16276);
cidr('152.228.0.0/16', 'OVH', 'host', 16276);
cidr('158.69.0.0/16', 'OVH', 'host', 16276);
cidr('164.132.0.0/16', 'OVH', 'host', 16276);
cidr('167.114.0.0/16', 'OVH', 'host', 16276);
cidr('176.31.0.0/16', 'OVH', 'host', 16276);
cidr('178.32.0.0/16', 'OVH', 'host', 16276);
cidr('178.33.0.0/16', 'OVH', 'host', 16276);
cidr('188.165.0.0/16', 'OVH', 'host', 16276);
cidr('192.99.0.0/16', 'OVH', 'host', 16276);
cidr('193.70.0.0/16', 'OVH', 'host', 16276);
cidr('198.245.48.0/20', 'OVH', 'host', 16276);
cidr('213.32.0.0/16', 'OVH', 'host', 16276);
cidr('213.186.32.0/19', 'OVH', 'host', 16276);
cidr('217.182.0.0/16', 'OVH', 'host', 16276);
cidr('37.59.0.0/16', 'OVH', 'host', 16276);
cidr('46.105.0.0/16', 'OVH', 'host', 16276);
cidr('51.178.0.0/16', 'OVH', 'host', 16276);
cidr('5.135.0.0/16', 'OVH', 'host', 16276);
cidr('5.196.0.0/16', 'OVH', 'host', 16276);
cidr('91.134.0.0/16', 'OVH', 'host', 16276);
cidr('5.9.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('46.4.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('49.12.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('78.46.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('88.99.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('116.202.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('116.203.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('128.140.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('136.243.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('138.201.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('144.76.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('148.251.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('159.69.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('167.233.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('168.119.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('176.9.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('195.201.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('213.133.96.0/19', 'Hetzner Online', 'host', 24940);
cidr('213.239.192.0/18', 'Hetzner Online', 'host', 24940);
cidr('23.88.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('65.108.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('65.109.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('65.21.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('94.130.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('95.216.0.0/16', 'Hetzner Online', 'host', 24940);
cidr('45.32.0.0/16', 'Vultr', 'host', 20473);
cidr('45.63.0.0/16', 'Vultr', 'host', 20473);
cidr('45.76.0.0/16', 'Vultr', 'host', 20473);
cidr('45.77.0.0/16', 'Vultr', 'host', 20473);
cidr('66.42.0.0/16', 'Vultr', 'host', 20473);
cidr('70.34.192.0/18', 'Vultr', 'host', 20473);
cidr('95.179.128.0/17', 'Vultr', 'host', 20473);
cidr('104.156.224.0/19', 'Vultr', 'host', 20473);
cidr('104.207.128.0/17', 'Vultr', 'host', 20473);
cidr('107.191.32.0/19', 'Vultr', 'host', 20473);
cidr('108.61.0.0/16', 'Vultr', 'host', 20473);
cidr('136.244.64.0/18', 'Vultr', 'host', 20473);
cidr('139.180.0.0/16', 'Vultr', 'host', 20473);
cidr('140.82.0.0/16', 'Vultr', 'host', 20473);
cidr('144.202.0.0/16', 'Vultr', 'host', 20473);
cidr('149.28.0.0/16', 'Vultr', 'host', 20473);
cidr('155.138.0.0/16', 'Vultr', 'host', 20473);
cidr('192.248.128.0/17', 'Vultr', 'host', 20473);
cidr('207.148.0.0/16', 'Vultr', 'host', 20473);
cidr('208.167.224.0/19', 'Vultr', 'host', 20473);
cidr('209.222.0.0/16', 'Vultr', 'host', 20473);
cidr('216.155.128.0/18', 'Vultr', 'host', 20473);
cidr('45.33.0.0/16', 'Akamai (Linode)', 'host', 63949);
cidr('45.56.0.0/16', 'Akamai (Linode)', 'host', 63949);
cidr('45.79.0.0/16', 'Akamai (Linode)', 'host', 63949);
cidr('50.116.0.0/16', 'Akamai (Linode)', 'host', 63949);
cidr('66.228.32.0/19', 'Akamai (Linode)', 'host', 63949);
cidr('72.14.176.0/20', 'Akamai (Linode)', 'host', 63949);
cidr('96.126.96.0/19', 'Akamai (Linode)', 'host', 63949);
cidr('97.107.128.0/19', 'Akamai (Linode)', 'host', 63949);
cidr('139.162.0.0/16', 'Akamai (Linode)', 'host', 63949);
cidr('172.104.0.0/16', 'Akamai (Linode)', 'host', 63949);
cidr('173.255.192.0/18', 'Akamai (Linode)', 'host', 63949);
cidr('192.81.128.0/17', 'Akamai (Linode)', 'host', 63949);
cidr('69.164.192.0/18', 'Akamai (Linode)', 'host', 63949);
cidr('74.207.224.0/19', 'Akamai (Linode)', 'host', 63949);
cidr('23.239.0.0/16', 'Akamai (Linode)', 'host', 63949);
cidr('178.79.128.0/18', 'Akamai (Linode)', 'host', 63949);
cidr('176.58.96.0/19', 'Akamai (Linode)', 'host', 63949);
cidr('192.0.64.0/18', 'Automattic (WordPress.com)', 'host', 2635);

/* Sorted by prefix length descending (most specific first). */
CIDRS.sort((a, b) => b.len - a.len);

function matchCidr(ip) {
  const n = ip4ToInt(ip);
  if (n == null) return null;
  for (const c of CIDRS) {
    if ((n & c.mask) === c.base) return c;
  }
  return null;
}

/* Cymru response parsers */
function parseCymruIp(txt) {
  // "15169 | 8.8.8.0/24 | US | arin | 2023-12-28"
  const parts = String(txt || '').split('|').map(s => s.trim());
  if (parts.length < 3 || !/^\d+$/.test(parts[0])) return null;
  return {
    asn: parts[0],
    prefix: parts[1] || null,
    country: parts[2] || null,
    registry: parts[3] || null,
    allocated: parts[4] || null
  };
}

function parseCymruAsn(txt) {
  // "15169 | US | arin | 2000-03-30 | GOOGLE, US"
  const parts = String(txt || '').split('|').map(s => s.trim());
  if (parts.length < 5 || !/^\d+$/.test(parts[0])) return null;
  return { asn: parts[0], country: parts[1] || null, registry: parts[2] || null, allocated: parts[3] || null, name: parts[4] || null };
}

function createAsnAnalyzer(opt) {
  opt = opt || {};
  const dns = opt.dns; // dnsClient
  const rdap = opt.rdap || null; // rdapClient (production enrichment)
  const cache = opt.cache || new Map();

  function ipv6ToNibbles(ip) {
    // expand to full 8 groups, reverse every nibble (one label per hex digit)
    const full = ip.toLowerCase().split('::');
    const head = full[0] ? full[0].split(':').filter(Boolean) : [];
    const tail = full[1] ? full[1].split(':').filter(Boolean) : [];
    const groups = head.concat(Array(Math.max(0, 8 - head.length - tail.length)).fill('0')).concat(tail);
    const addr = groups.map(g => String(g).padStart(4, '0')).join('').slice(0, 32);
    return addr.split('').reverse().join('.');
  }

  async function cymruForIp(ip) {
    if (!dns) return { ok: false, reason: 'no_dns_client' };
    const isV6 = ip.includes(':');
    const q = isV6
      ? ipv6ToNibbles(ip) + '.origin6.asn.cymru.com'
      : ip.split('.').reverse().join('.') + '.origin.asn.cymru.com';
    try {
      const res = await dns.query(q, 'TXT');
      if (res.rcode !== 0 || !res.answers.length) return { ok: false, reason: 'no_cymru_data' };
      const val = res.answers.map(a => a.value).find(v => /^\d+\s*\|/.test(v || ''));
      if (!val) return { ok: false, reason: 'unparsable' };
      const parsed = parseCymruIp(val);
      return parsed ? { ok: true, ...parsed, source: 'cymru-dns' } : { ok: false, reason: 'unparsable' };
    } catch (e) {
      return { ok: false, reason: 'cymru_dns_failed' };
    }
  }

  async function cymruAsnName(asn) {
    if (!dns) return null;
    const q = 'AS' + asn + '.asn.cymru.com';
    try {
      const res = await dns.query(q, 'TXT');
      if (res.rcode !== 0 || !res.answers.length) return null;
      const val = res.answers.map(a => a.value).find(v => /^\d+\s*\|/.test(v || ''));
      return val ? parseCymruAsn(val) : null;
    } catch (e) {
      return null;
    }
  }

  async function analyzeIp(ip, opts) {
    opts = opts || {};
    if (cache.has('ip:' + ip)) return cache.get('ip:' + ip);
    const out = {
      ip,
      version: ip.includes(':') ? 6 : 4,
      asn: null,
      asnOrg: null,      // raw org name from BGP data (Cymru/RDAP)
      provider: null,    // friendly name (local table when known)
      providerKind: null, // cdn | cloud | host | isp
      network: null,     // announced prefix
      country: null,     // country-level only
      sources: [],
      conflicts: [],
      confidence: 0
    };
    const conflicts = U.ConflictTracker();
    const local = matchCidr(ip);

    if (local) {
      out.sources.push('local-cidr');
      out.provider = local.name;
      out.providerKind = local.kind;
      conflicts.note('network provider', local.name, 'local-cidr');
    }

    const cymru = await cymruForIp(ip);
    if (cymru.ok) {
      out.sources.push('cymru-dns');
      out.asn = cymru.asn;
      out.network = cymru.prefix;
      out.country = cymru.country || null;
      const known = ASN_NAMES[cymru.asn];
      const asnInfo = await cymruAsnName(cymru.asn);
      if (asnInfo && asnInfo.name) out.asnOrg = asnInfo.name;
      if (known) {
        out.provider = out.provider || known.name;
        out.providerKind = out.providerKind || known.kind;
        conflicts.note('network provider', known.name, 'asn-name-database (AS' + cymru.asn + ')');
      }
      conflicts.note('ASN', cymru.asn, 'cymru-dns');
    }

    // RDAP IP → network org (production only; also fills IPv6).
    if (rdap && opts.allowRdap !== false && out.version === 4) {
      const r = await rdap.lookupIp(ip);
      if (r.outcome === 'ok') {
        out.sources.push('rdap');
        if (r.asn && r.asn.asn) {
          conflicts.note('ASN', String(r.asn.asn), 'rdap');
          if (!out.asn) out.asn = String(r.asn.asn);
        }
        if (r.orgName) {
          conflicts.note('network org', r.orgName, 'rdap');
          if (!out.asnOrg) out.asnOrg = r.orgName;
        }
        if (r.country && !out.country) out.country = r.country;
      }
    }

    out.conflicts = conflicts.list();
    if (!out.asn && local && local.asn) out.asn = String(local.asn);
    if (!out.asnOrg && out.provider) out.asnOrg = out.provider;
    if (out.conflicts.length) out.confidence = U.conf(55);
    else if (out.sources.length >= 2) out.confidence = U.conf(92);
    else if (out.sources.length === 1) out.confidence = U.conf(out.sources[0] === 'cymru-dns' ? 88 : 80);
    else out.confidence = 0;
    out.timestamp = U.nowIso();
    cache.set('ip:' + ip, out);
    return out;
  }

  return { analyzeIp, matchCidr, ASN_NAMES };
}

module.exports = { createAsnAnalyzer, matchCidr, parseCymruIp, parseCymruAsn, ASN_NAMES };
