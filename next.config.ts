import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: it must be required at runtime by Node,
  // never bundled by webpack/turbopack.
  serverExternalPackages: ['better-sqlite3'],
  // Antenna keeps its own canon in ANTENNA_BLUEPRINT.md; don't scaffold others.
  agentRules: false,
  // Hive serves the dev server to Conner's phone over Tailscale (127.0.0.1 + tailnet
  // forwarder only, never a public interface). Without this, Next blocks HMR and dev
  // assets for any origin but localhost.
  allowedDevOrigins: ['hive.taile4c254.ts.net', '100.115.232.31'],
}

export default nextConfig
