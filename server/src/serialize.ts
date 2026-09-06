import type { User as PrismaUser } from '@prisma/client'

// Convert a Prisma User row into the client-facing shape matching src/lib/data.ts's `User`
// interface. We never send passwordHash back; `password` is filled with a masked placeholder
// since no UI reads it except at account-creation time (handled separately in routes/users.ts).
export function toClientUser(u: PrismaUser, plainPassword?: string) {
  return {
    id: u.id,
    role: u.role,
    name: u.name,
    email: u.email,
    password: plainPassword ?? '••••••••',
    title: u.title,
    avatarHue: u.avatarHue,
    verified: u.verified,
    mustChangePassword: u.mustChangePassword,
    class: u.class ?? undefined,
    section: u.section ?? undefined,
    roll: u.roll ?? undefined,
    subjects: (u.subjects as string[] | null) ?? undefined,
    department: u.department ?? undefined,
    designation: u.designation ?? undefined,
    reportsTo: u.reportsTo ?? undefined,
    joinDate: u.joinDate ?? undefined,
    phone: u.phone ?? undefined,
    parentEmail: u.parentEmail ?? undefined,
    board: (u.board as any) ?? undefined,
    dob: u.dob ?? undefined,
    salary: u.salary ?? undefined,
    wards: u.wards ?? undefined,
    contract: (u.contract as any) ?? undefined,
    resignation: (u.resignation as any) ?? undefined,
  }
}
