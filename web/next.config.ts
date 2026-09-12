import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stamped into the service worker URL so every deploy produces a new script
  // to fetch, which is what makes the browser notice there is an update at all.
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? String(Date.now()),
  },
  /* config options here */
};

export default nextConfig;
