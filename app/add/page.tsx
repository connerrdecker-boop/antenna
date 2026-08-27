import { AddClient } from '@/components/AddClient'

export const dynamic = 'force-dynamic'

export default function AddPage() {
  return (
    <>
      <h1 className="h1">Add candidates</h1>
      <p className="sub">
        Paste handles or Instagram URLs, or drop a CSV. Everything lands as <code>sourced</code> /
        <code> source=manual</code> and waits for the ratify queue. Warm intros enter here — they
        skip Harvest, never Track.
      </p>
      <AddClient />
    </>
  )
}
