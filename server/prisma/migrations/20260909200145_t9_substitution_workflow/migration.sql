-- CreateTable
CREATE TABLE "SubstitutionPolicy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'TEACHER_INITIATED',
    "minNoticeHoursForSubstitution" INTEGER NOT NULL DEFAULT 12,
    "allowCrossSubject" BOOLEAN NOT NULL DEFAULT false,
    "maxWeeklySubstitutePeriods" INTEGER NOT NULL DEFAULT 30,
    "tentativeHoldExpiryMinutes" INTEGER NOT NULL DEFAULT 240,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubstitutionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubstitutionRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "originalTeacherId" TEXT NOT NULL,
    "substituteTeacherId" TEXT NOT NULL,
    "periods" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "mode" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideNote" TEXT,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubstitutionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodHold" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "periodIdx" INTEGER NOT NULL,
    "termId" TEXT NOT NULL,
    "holdType" TEXT NOT NULL,
    "sourceSubstitutionRequestId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubstitutionPolicy_schoolId_key" ON "SubstitutionPolicy"("schoolId");

-- CreateIndex
CREATE INDEX "SubstitutionRequest_schoolId_idx" ON "SubstitutionRequest"("schoolId");

-- CreateIndex
CREATE INDEX "SubstitutionRequest_leaveRequestId_idx" ON "SubstitutionRequest"("leaveRequestId");

-- CreateIndex
CREATE INDEX "SubstitutionRequest_substituteTeacherId_status_idx" ON "SubstitutionRequest"("substituteTeacherId", "status");

-- CreateIndex
CREATE INDEX "SubstitutionRequest_originalTeacherId_idx" ON "SubstitutionRequest"("originalTeacherId");

-- CreateIndex
CREATE INDEX "PeriodHold_schoolId_idx" ON "PeriodHold"("schoolId");

-- CreateIndex
CREATE INDEX "PeriodHold_teacherId_date_periodIdx_idx" ON "PeriodHold"("teacherId", "date", "periodIdx");

-- CreateIndex
CREATE INDEX "PeriodHold_sourceSubstitutionRequestId_idx" ON "PeriodHold"("sourceSubstitutionRequestId");

-- AddForeignKey
ALTER TABLE "SubstitutionPolicy" ADD CONSTRAINT "SubstitutionPolicy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionRequest" ADD CONSTRAINT "SubstitutionRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionRequest" ADD CONSTRAINT "SubstitutionRequest_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionRequest" ADD CONSTRAINT "SubstitutionRequest_originalTeacherId_fkey" FOREIGN KEY ("originalTeacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionRequest" ADD CONSTRAINT "SubstitutionRequest_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionRequest" ADD CONSTRAINT "SubstitutionRequest_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionRequest" ADD CONSTRAINT "SubstitutionRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodHold" ADD CONSTRAINT "PeriodHold_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodHold" ADD CONSTRAINT "PeriodHold_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodHold" ADD CONSTRAINT "PeriodHold_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodHold" ADD CONSTRAINT "PeriodHold_sourceSubstitutionRequestId_fkey" FOREIGN KEY ("sourceSubstitutionRequestId") REFERENCES "SubstitutionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
