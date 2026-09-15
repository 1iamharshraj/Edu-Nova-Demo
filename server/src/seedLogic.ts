import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

const SCHOOL_NAME = 'Edkonic Senior Secondary School'
export const PRINCIPAL = { id: 'u-sa', email: 'principal@edkonic.in', password: 'principal123', name: 'Dr. Arun Nambiar' }

// Idempotent: ensures exactly one School and one superadmin (principal) exist. Nothing else.
// The demo content is loaded separately via POST /api/admin/load-sample-data (src/sampleData.ts).
export async function seedSchool(): Promise<string> {
  let school = await prisma.school.findFirst()
  if (!school) school = await prisma.school.create({ data: { name: SCHOOL_NAME } })

  const existing = await prisma.user.findUnique({ where: { email: PRINCIPAL.email } })
  if (!existing) {
    await prisma.user.create({
      data: {
        id: PRINCIPAL.id,
        schoolId: school.id,
        role: 'superadmin',
        name: PRINCIPAL.name,
        email: PRINCIPAL.email,
        passwordHash: await bcrypt.hash(PRINCIPAL.password, 10),
        mustChangePassword: true,
        title: 'Principal & Superadmin',
        avatarHue: 280,
        verified: true,
        designation: 'Principal',
        department: 'Administration',
      },
    })
  }
  return school.id
}
