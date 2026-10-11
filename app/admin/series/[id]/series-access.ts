// app/admin/series/[id]/series-access.ts
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { hasSeriesModeratorOrAbove, isOwnerOrAdmin } from '../../../lib/permissions'

/** Reihe der Reihen-Seite samt Rechten, einmal pro Anfrage (cache) für Layout und Reiter. null = 404. */
export const loadAdminSeries = cache(async (id: string) => {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  const series = await prisma.eventSeries.findUnique({ where: { id }, include: { owner: { select: { email: true } }, _count: { select: { events: true, guestMembers: true, invitations: true } } } })
  if (!series) return null
  const isOwner = isOwnerOrAdmin(user, series.ownerId)
  if (!isOwner && !(await hasSeriesModeratorOrAbove(user, series))) return null
  return { user, series, isOwner }
})
