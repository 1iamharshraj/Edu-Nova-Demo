import { seedSchool } from '../src/seedLogic'
import { prisma } from '../src/prisma'

async function main() {
  const schoolId = await seedSchool()
  console.log(`Seeded school ${schoolId} with superadmin principal@edkonic.in / principal123 (mustChangePassword)`)
}

main()
  .catch(e => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
