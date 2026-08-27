'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LIVE = [
  { href: '/ratify', label: 'Ratify' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/add', label: 'Add' },
]

/** Routes the blueprint reserves for later phases — shown so the cockpit's shape is legible. */
const PLANNED = [
  { label: 'Metrics', phase: 'A4' },
  { label: 'Settings', phase: 'A3' },
]

export function Nav() {
  const pathname = usePathname()
  return (
    <header className="topbar">
      <div className="brand">
        ANTENNA<span>Instar outreach engine</span>
      </div>
      <nav className="nav">
        {LIVE.map((l) => (
          <Link key={l.href} href={l.href} className={pathname.startsWith(l.href) ? 'active' : ''}>
            {l.label}
          </Link>
        ))}
        {PLANNED.map((p) => (
          <span key={p.label} className="soon" title={`Arrives in phase ${p.phase}`}>
            {p.label}
            <em>{p.phase}</em>
          </span>
        ))}
      </nav>
      <div className="spacer" />
      <span className="local" title="Single user, no auth. Never deploy this publicly.">
        localhost only
      </span>
    </header>
  )
}
