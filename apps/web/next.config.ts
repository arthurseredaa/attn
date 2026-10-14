import type { NextConfig } from 'next';

// Evaluated at build time for the rewrite: Docker passes API_URL as a build arg.
const apiUrl = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

const config: NextConfig = {
  transpilePackages: ['@attn/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default config;
