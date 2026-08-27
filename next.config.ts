import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: it must be required at runtime by Node,
  // never bundled by webpack/turbopack.
  serverExternalPackages: ['better-sqlite3'],
  // Antenna keeps its own canon in ANTENNA_BLUEPRINT.md; don't scaffold others.
  agentRules: false,
}

export default nextConfig
