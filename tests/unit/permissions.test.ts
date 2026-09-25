import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@prisma/client'

// permissions.ts legt einen eigenen PrismaClient an - hier ersetzt durch eine Attrappe, deren
// ResourceAccess-Abfrage jeder Test selbst beantwortet.
const findFirst = vi.fn()
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    resourceAccess = { findFirst }
  }
}))

const { hasEventModeratorOrAbove, hasModeratorAccess, hasSeriesModeratorOrAbove, isOwnerOrAdmin } = await import('../../app/lib/permissions')

const user = (id: string, role: User['role']) => ({ id, role }) as User
const owner = user('owner', 'CREATOR')
const admin = user('admin', 'ADMIN')
const stranger = user('fremd', 'CREATOR')
const moderator = user('mod', 'MODERATOR')

const event = { id: 'event-1', ownerId: 'owner', seriesId: null }
const termin = { id: 'termin-1', ownerId: 'owner', seriesId: 'reihe-1' }
const series = { id: 'reihe-1', ownerId: 'owner' }

beforeEach(() => {
  findFirst.mockReset()
  findFirst.mockResolvedValue(null)
})

describe('isOwnerOrAdmin', () => {
  it('Owner und Admin ja, alle anderen nein - auch eine Moderator*in mit Freigabe', () => {
    expect(isOwnerOrAdmin(owner, 'owner')).toBe(true)
    expect(isOwnerOrAdmin(admin, 'owner')).toBe(true)
    expect(isOwnerOrAdmin(stranger, 'owner')).toBe(false)
    expect(isOwnerOrAdmin(moderator, 'owner')).toBe(false)
  })
})

describe('hasEventModeratorOrAbove', () => {
  it('Owner und Admin brauchen keine Freigabe (keine Datenbankabfrage)', async () => {
    expect(await hasEventModeratorOrAbove(owner, event)).toBe(true)
    expect(await hasEventModeratorOrAbove(admin, termin)).toBe(true)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('fremdes Konto ohne Freigabe: nein', async () => {
    expect(await hasEventModeratorOrAbove(stranger, event)).toBe(false)
    expect(findFirst).toHaveBeenCalledWith({ where: { userId: 'fremd', OR: [{ eventId: 'event-1' }] } })
  })

  it('Einzel-Event: sucht nur eine Freigabe genau dieses Events', async () => {
    findFirst.mockResolvedValue({ id: 'access' })
    expect(await hasEventModeratorOrAbove(moderator, event)).toBe(true)
    expect(findFirst).toHaveBeenCalledWith({ where: { userId: 'mod', OR: [{ eventId: 'event-1' }] } })
  })

  it('Reihen-Termin: eine Freigabe der ganzen Reihe zählt ebenfalls', async () => {
    findFirst.mockResolvedValue({ id: 'access' })
    expect(await hasEventModeratorOrAbove(moderator, termin)).toBe(true)
    expect(findFirst).toHaveBeenCalledWith({ where: { userId: 'mod', OR: [{ eventId: 'termin-1' }, { seriesId: 'reihe-1' }] } })
  })

  it('hasModeratorAccess fragt immer mit der eigenen userId, nie ohne Bedingung', async () => {
    await hasModeratorAccess('mod', { eventId: 'event-1' })
    const [{ where }] = findFirst.mock.calls[0]
    expect(where.userId).toBe('mod')
    expect(where.OR.length).toBeGreaterThan(0)
  })
})

describe('hasSeriesModeratorOrAbove', () => {
  it('Owner/Admin ja, Moderator*in nur mit Freigabe genau dieser Reihe', async () => {
    expect(await hasSeriesModeratorOrAbove(owner, series)).toBe(true)
    expect(await hasSeriesModeratorOrAbove(admin, series)).toBe(true)
    expect(await hasSeriesModeratorOrAbove(moderator, series)).toBe(false)
    findFirst.mockResolvedValue({ id: 'access' })
    expect(await hasSeriesModeratorOrAbove(moderator, series)).toBe(true)
    expect(findFirst).toHaveBeenLastCalledWith({ where: { userId: 'mod', seriesId: 'reihe-1' } })
  })
})
