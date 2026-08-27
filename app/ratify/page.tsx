import { RatifyClient } from '@/components/RatifyClient'
import { listRatifyQueue } from '@/db/repo'

export const dynamic = 'force-dynamic'

export default function RatifyPage() {
  const queue = listRatifyQueue()
  return (
    <>
      <h1 className="h1">Ratify</h1>
      <p className="sub">
        The taste gate, industrialized (Law 10). <b>y</b> approve · <b>n</b> reject · <b>b</b> bank ·{' '}
        <b>f</b> flag · <b>j/k</b> navigate · <b>u</b> undo last. Every keystroke is training data.
      </p>
      <RatifyClient initialQueue={queue} />
    </>
  )
}
