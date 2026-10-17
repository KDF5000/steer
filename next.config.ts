import type { NextConfig } from 'next';

// Rewrites are resolved at build time. Only the Go API origin belongs here;
// credentials stay on the backend and are never included in browser bundles.
const apiOrigin = new URL(
  process.env.STEER_API_ORIGIN || 'http://localhost:8080',
);
if (
  !['http:', 'https:'].includes(apiOrigin.protocol) ||
  apiOrigin.username ||
  apiOrigin.password ||
  apiOrigin.pathname !== '/' ||
  apiOrigin.search ||
  apiOrigin.hash
) {
  throw new Error(
    'STEER_API_ORIGIN must be an HTTP(S) origin without a path or credentials',
  );
}

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/api/v1/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'x-vercel-enable-rewrite-caching', value: 'false' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin.origin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
