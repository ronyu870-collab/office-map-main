import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['ali-oss'],
  outputFileTracingIncludes: { '/api/quarterly-research': ['./private/quarterly-research/*.html'] },
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },

  // Bundle optimization: reduce client-side JS parse time
  experimental: {
    optimizePackageImports: [
      'echarts',
      'lucide-react',
      '@supabase/supabase-js',
    ],
  },
};

export default nextConfig;
