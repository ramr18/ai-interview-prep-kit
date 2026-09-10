/** @type {import('next').NextConfig} */
const API_TARGET = (process.env.API_PROXY_TARGET || "http://localhost:4000").replace(/\/$/, "");

// When NEXT_PUBLIC_API_BASE is unset the browser talks to /api/* on this
// origin and the Next.js server proxies to Express (keeps the session cookie
// same-origin). When it IS set, the client calls the API directly and the
// backend relies on CORS + SameSite=None cookies.
const sameOrigin = !process.env.NEXT_PUBLIC_API_BASE;

const nextConfig = {
  async rewrites() {
    return sameOrigin
      ? [{ source: "/api/:path*", destination: `${API_TARGET}/api/:path*` }]
      : [];
  },
};

export default nextConfig;