import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { cpus: 1 },
};

export default config;
