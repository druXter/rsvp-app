// app/admin/kueche/[eventId]/page.tsx
import { redirect } from 'next/navigation'

/** Frühere Adresse - die Seite ist jetzt ein Reiter der Event-Seite (docs/KONZEPT-OBERFLAECHE.md). Query bleibt erhalten. */
export default async function Redirect({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventId } = await params
  const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(v => [key, v]))).toString()
  redirect(`/admin/events/${eventId}/kueche${query ? `?${query}` : ''}`)
}
