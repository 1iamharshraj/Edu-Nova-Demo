-- DropIndex
DROP INDEX "FeeInvoice_studentId_feeStructureId_key";

-- AlterTable
ALTER TABLE "FeeInvoice" ADD COLUMN     "installmentLabel" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "installmentPlanId" TEXT;

-- CreateTable
CREATE TABLE "FeeInstallmentPlan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "feeStructureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "installments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeInstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scholarship" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "criteria" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scholarship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScholarshipAward" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "scholarshipId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reason" TEXT,
    "proposedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "appliedToInvoiceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totalDiscountApplied" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScholarshipAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeInstallmentPlan_schoolId_idx" ON "FeeInstallmentPlan"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeInstallmentPlan_feeStructureId_name_key" ON "FeeInstallmentPlan"("feeStructureId", "name");

-- CreateIndex
CREATE INDEX "Scholarship_schoolId_idx" ON "Scholarship"("schoolId");

-- CreateIndex
CREATE INDEX "ScholarshipAward_schoolId_idx" ON "ScholarshipAward"("schoolId");

-- CreateIndex
CREATE INDEX "ScholarshipAward_studentId_idx" ON "ScholarshipAward"("studentId");

-- CreateIndex
CREATE INDEX "ScholarshipAward_academicYearId_idx" ON "ScholarshipAward"("academicYearId");

-- CreateIndex
CREATE INDEX "ScholarshipAward_status_idx" ON "ScholarshipAward"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ScholarshipAward_scholarshipId_studentId_academicYearId_key" ON "ScholarshipAward"("scholarshipId", "studentId", "academicYearId");

-- CreateIndex
CREATE INDEX "FeeInvoice_installmentPlanId_idx" ON "FeeInvoice"("installmentPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeInvoice_studentId_feeStructureId_installmentLabel_key" ON "FeeInvoice"("studentId", "feeStructureId", "installmentLabel");

-- AddForeignKey
ALTER TABLE "FeeInstallmentPlan" ADD CONSTRAINT "FeeInstallmentPlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInstallmentPlan" ADD CONSTRAINT "FeeInstallmentPlan_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "FeeStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_installmentPlanId_fkey" FOREIGN KEY ("installmentPlanId") REFERENCES "FeeInstallmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scholarship" ADD CONSTRAINT "Scholarship_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_scholarshipId_fkey" FOREIGN KEY ("scholarshipId") REFERENCES "Scholarship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

