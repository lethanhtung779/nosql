import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL || 'http://localhost:3001';
const config: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  }
};

export default config;
