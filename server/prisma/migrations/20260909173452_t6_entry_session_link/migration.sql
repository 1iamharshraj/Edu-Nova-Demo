-- AlterTable
ALTER TABLE "TimetableEntry" ADD COLUMN     "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "TimetableEntry_sessionId_idx" ON "TimetableEntry"("sessionId");

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TimetableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
