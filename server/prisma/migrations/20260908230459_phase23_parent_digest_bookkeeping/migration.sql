/*
  Warnings:

  - Added the required column `hostelId` to the `HostelOutpass` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "HostelOutpass" ADD COLUMN     "hostelId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "ParentDigestSend" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "digestDate" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentDigestSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParentDigestSend_schoolId_idx" ON "ParentDigestSend"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ParentDigestSend_parentId_digestDate_key" ON "ParentDigestSend"("parentId", "digestDate");

-- CreateIndex
CREATE INDEX "HostelOutpass_hostelId_idx" ON "HostelOutpass"("hostelId");

-- AddForeignKey
ALTER TABLE "HostelOutpass" ADD CONSTRAINT "HostelOutpass_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentDigestSend" ADD CONSTRAINT "ParentDigestSend_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentDigestSend" ADD CONSTRAINT "ParentDigestSend_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
