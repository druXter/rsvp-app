// app/admin/events/[id]/anwesenheit/auto-refresh.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Lädt die Seite alle `seconds` Sekunden neu, solange sie sichtbar ist - für die Anwesenheit während der Sitzung. */
export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') router.refresh() }, seconds * 1000)
    return () => clearInterval(timer)
  }, [router, seconds])
  return null
}
