import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // F1 · Route renames to Spanish (2026-04-19). Permanent 308 so bookmarks
      // and links in external tools (emails, etc.) continue to work.
      { source: "/agents", destination: "/directores", permanent: true },
      { source: "/agents/:path*", destination: "/directores/:path*", permanent: true },
      { source: "/system", destination: "/sistema", permanent: true },
      { source: "/system/:path*", destination: "/sistema/:path*", permanent: true },
      { source: "/companies", destination: "/empresas", permanent: true },
      { source: "/companies/:path*", destination: "/empresas/:path*", permanent: true },
      { source: "/contacts", destination: "/contactos", permanent: true },
      { source: "/contacts/:path*", destination: "/contactos/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
