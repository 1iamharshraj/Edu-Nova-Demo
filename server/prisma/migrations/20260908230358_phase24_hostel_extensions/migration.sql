-- CreateTable
CREATE TABLE "HostelOutpass" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedDepartureAt" TIMESTAMP(3) NOT NULL,
    "expectedReturnAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "approvedByWardenId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "actualDepartureAt" TIMESTAMP(3),
    "actualReturnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostelOutpass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelRollCall" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostelRollCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelRollCallEntry" (
    "id" TEXT NOT NULL,
    "rollCallId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "HostelRollCallEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessMenu" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mealType" TEXT NOT NULL,
    "items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealFeedback" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HostelOutpass_schoolId_idx" ON "HostelOutpass"("schoolId");

-- CreateIndex
CREATE INDEX "HostelOutpass_studentId_idx" ON "HostelOutpass"("studentId");

-- CreateIndex
CREATE INDEX "HostelOutpass_status_idx" ON "HostelOutpass"("status");

-- CreateIndex
CREATE INDEX "HostelRollCall_schoolId_idx" ON "HostelRollCall"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "HostelRollCall_hostelId_date_key" ON "HostelRollCall"("hostelId", "date");

-- CreateIndex
CREATE INDEX "HostelRollCallEntry_allocationId_idx" ON "HostelRollCallEntry"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "HostelRollCallEntry_rollCallId_allocationId_key" ON "HostelRollCallEntry"("rollCallId", "allocationId");

-- CreateIndex
CREATE INDEX "MessMenu_schoolId_idx" ON "MessMenu"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "MessMenu_hostelId_date_mealType_key" ON "MessMenu"("hostelId", "date", "mealType");

-- CreateIndex
CREATE INDEX "MealFeedback_schoolId_idx" ON "MealFeedback"("schoolId");

-- CreateIndex
CREATE INDEX "MealFeedback_menuId_idx" ON "MealFeedback"("menuId");

-- CreateIndex
CREATE UNIQUE INDEX "MealFeedback_menuId_studentId_key" ON "MealFeedback"("menuId", "studentId");

-- AddForeignKey
ALTER TABLE "HostelOutpass" ADD CONSTRAINT "HostelOutpass_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelOutpass" ADD CONSTRAINT "HostelOutpass_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelOutpass" ADD CONSTRAINT "HostelOutpass_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelOutpass" ADD CONSTRAINT "HostelOutpass_approvedByWardenId_fkey" FOREIGN KEY ("approvedByWardenId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelRollCall" ADD CONSTRAINT "HostelRollCall_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelRollCall" ADD CONSTRAINT "HostelRollCall_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelRollCall" ADD CONSTRAINT "HostelRollCall_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelRollCallEntry" ADD CONSTRAINT "HostelRollCallEntry_rollCallId_fkey" FOREIGN KEY ("rollCallId") REFERENCES "HostelRollCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelRollCallEntry" ADD CONSTRAINT "HostelRollCallEntry_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "HostelAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessMenu" ADD CONSTRAINT "MessMenu_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessMenu" ADD CONSTRAINT "MessMenu_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessMenu" ADD CONSTRAINT "MessMenu_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealFeedback" ADD CONSTRAINT "MealFeedback_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealFeedback" ADD CONSTRAINT "MealFeedback_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "MessMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealFeedback" ADD CONSTRAINT "MealFeedback_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
