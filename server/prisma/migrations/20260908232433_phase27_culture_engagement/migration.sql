-- CreateTable
CREATE TABLE "HousePoints" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "houseActivityId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "awardedById" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" TEXT,
    "sourceRefId" TEXT,

    CONSTRAINT "HousePoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HousePoints_schoolId_idx" ON "HousePoints"("schoolId");

-- CreateIndex
CREATE INDEX "HousePoints_houseActivityId_idx" ON "HousePoints"("houseActivityId");

-- AddForeignKey
ALTER TABLE "HousePoints" ADD CONSTRAINT "HousePoints_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousePoints" ADD CONSTRAINT "HousePoints_houseActivityId_fkey" FOREIGN KEY ("houseActivityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousePoints" ADD CONSTRAINT "HousePoints_awardedById_fkey" FOREIGN KEY ("awardedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
