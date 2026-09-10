/** Raised for an URL that must not be fetched (SSRF guard, malformed, ...). */
export class UrlBlockedError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "UrlBlockedError";
    this.code = code;
  }
}

// IPv4 private / special-purpose ranges, represented as {start, end} uint32s.
const IPV4_BLOCKS = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 "this network"
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
  [0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 TEST-NET
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 benchmarking
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 TEST-NET-3
  [0xe0000000, 0xffffffff], // 224.0.0.0/4 multicast + 240/4 reserved
];

/** True when the given IP string (v4 or v6) is private / non-routable. */
export function isPrivateAddress(ip) {
  if (!ip) return true;
  const v = ip.trim().toLowerCase();

  // IPv6 loopback, link-local, unique-local, unspecified.
  if (
    v === "::1" ||
    v === "::" ||
    v.startsWith("fe80:") ||
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    v.startsWith("::ffff:127.") ||
    v.startsWith("::ffff:10.") ||
    v.startsWith("::ffff:172.16") ||
    v.startsWith("::ffff:192.168")
  ) {
    return true;
  }

  const parts = v.split(".");
  if (parts.length !== 4) {
    // unknown / non-IPv4 literal -> not classified as private (dns resolution
    // is done separately when needed).
    return false;
  }
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const value = ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
  return IPV4_BLOCKS.some(([s, e]) => value >= s && value <= e);
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

function isIpLiteral(host) {
  return IPV4_RE.test(host) || (IPV6_RE.test(host) && host.includes(":"));
}

/**
 * Resolve a hostname to its addresses (best effort). Falls back to an empty
 * list when neither node:net nor node:dns can help, so strict blocking still
 * uses literal-IP checks and only skips DNS pinning.
 */
export async function resolveHostAddresses(hostname) {
  const addrs = [];
  try {
    const net = await import("node:net");
    if (typeof net.resolve === "function") {
      for (const family of ["ipv4", "ipv6"]) {
        try {
          const r = await net.resolve(hostname, family);
          addrs.push(...r.map(String));
        } catch {
          /* try next family */
        }
      }
    }
  } catch {
    /* no node:net */
  }
  if (addrs.length === 0) {
    try {
      const dns = await import("node:dns");
      for (const family of ["A", "AAAA"]) {
        const recs = (await dns.lookup(hostname, family)) || [];
        for (const rec of recs) if (rec && rec.address) addrs.push(String(rec.address));
      }
    } catch {
      /* no node:dns records */
    }
  }
  return addrs;
}

/**
 * Validate that a URL is safe for the app to fetch. Throws UrlBlockedError
 * when it is malformed, a non-http(s) scheme, or (unless allowPrivate) points
 * at a loopback/private/LAN address.
 *
 * @returns {{url:string, host:string, origin:string}}
 */
export async function validateExternalUrl(raw, { allowPrivate = false } = {}) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new UrlBlockedError("invalid_url", "URL is not parseable");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UrlBlockedError("unsupported_scheme", "Only http(s) URLs are allowed");
  }
  if (!u.hostname) throw new UrlBlockedError("invalid_url", "URL has no host");
  if (u.username || u.password) {
    throw new UrlBlockedError("credentials", "URLs with embedded credentials are not allowed");
  }
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UrlBlockedError("invalid_port", "URL has an invalid port");
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(" ") || host.startsWith(".")) {
    throw new UrlBlockedError("invalid_url", "URL has an invalid host");
  }

  if (isIpLiteral(host)) {
    if (isPrivateAddress(host) && !allowPrivate) {
      throw new UrlBlockedError("private_address", "Loopback/private addresses are blocked");
    }
  } else if (!allowPrivate) {
    const addrs = await resolveHostAddresses(host);
    for (const addr of addrs) {
      if (isPrivateAddress(addr)) {
        throw new UrlBlockedError("private_address", "Target resolves to a loopback/private address");
      }
    }
  }

  u.hostname = host;
  return { url: u.toString(), host, origin: u.origin };
}

/** Resolve a possibly-relative href against a base URL; null when invalid. */
export function resolveRelative(baseUrl, href) {
  try {
    return new URL(String(href).trim(), baseUrl).toString();
  } catch {
    return null;
  }
}

/** True when the URL points at the same host (for crawl scope). */
export function sameHost(a, b) {
  try {
    return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase();
  } catch {
    return false;
  }
}