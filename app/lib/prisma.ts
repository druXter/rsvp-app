// app/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

// Der eine gemeinsame Client der App - nie einen eigenen `new PrismaClient()` anlegen: jeder Client hält eigene
// Verbindungen und eigenen Speicher, und in der Entwicklung entstünde bei jedem Hot Reload ein weiterer.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
export const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
