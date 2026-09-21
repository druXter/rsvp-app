// app/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

// Ein gemeinsamer Client für die neueren Module (Drosselung, Verbund). Ältere Dateien legen
// noch je einen eigenen PrismaClient an - das funktioniert, verbraucht aber je eine Verbindung.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
export const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
