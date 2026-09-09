import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const school = await prisma.school.findFirst()
const h = await prisma.highlight.count({ where: { schoolId: school.id } })
const c = await prisma.aiConversation.count({ where: { schoolId: school.id } })
const m = await prisma.aiMessage.count()
console.log('highlights:', h, 'aiConversations:', c, 'aiMessages(total):', m)
await prisma.$disconnect()
