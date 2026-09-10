-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "admissionCategoryId" TEXT,
ADD COLUMN     "admissionMode" TEXT,
ADD COLUMN     "declaredTrackPreference" TEXT,
ADD COLUMN     "healthFlags" JSONB,
ADD COLUMN     "lastGradeCompleted" TEXT,
ADD COLUMN     "previousBoardId" TEXT,
ADD COLUMN     "previousSchoolName" TEXT,
ADD COLUMN     "siblingStudentId" TEXT,
ADD COLUMN     "transportHandledAt" TIMESTAMP(3),
ADD COLUMN     "transportPreferredArea" TEXT,
ADD COLUMN     "transportRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PriorSubjectScore" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriorSubjectScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionCategory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requiresCertificate" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequiredDocumentType" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requiredIfCategoryIn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredIfAdmissionMode" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredIfBoardChanged" BOOLEAN NOT NULL DEFAULT false,
    "alwaysRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequiredDocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmittedDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT,
    "studentId" TEXT,
    "requiredDocumentTypeId" TEXT,
    "fileId" TEXT,
    "isOriginal" BOOLEAN NOT NULL DEFAULT false,
    "physicalLocationRoom" TEXT,
    "physicalLocationShelf" TEXT,
    "physicalLocationFolder" TEXT,
    "receivedDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "returnedDate" DATE,
    "returnedTo" TEXT,
    "returnReason" TEXT,
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmittedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "admissionDocumentsBlockApproval" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriorSubjectScore_schoolId_idx" ON "PriorSubjectScore"("schoolId");

-- CreateIndex
CREATE INDEX "PriorSubjectScore_applicationId_idx" ON "PriorSubjectScore"("applicationId");

-- CreateIndex
CREATE INDEX "AdmissionCategory_schoolId_idx" ON "AdmissionCategory"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionCategory_schoolId_code_key" ON "AdmissionCategory"("schoolId", "code");

-- CreateIndex
CREATE INDEX "RequiredDocumentType_schoolId_idx" ON "RequiredDocumentType"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "RequiredDocumentType_schoolId_code_key" ON "RequiredDocumentType"("schoolId", "code");

-- CreateIndex
CREATE INDEX "SubmittedDocument_schoolId_idx" ON "SubmittedDocument"("schoolId");

-- CreateIndex
CREATE INDEX "SubmittedDocument_applicationId_idx" ON "SubmittedDocument"("applicationId");

-- CreateIndex
CREATE INDEX "SubmittedDocument_studentId_idx" ON "SubmittedDocument"("studentId");

-- CreateIndex
CREATE INDEX "SubmittedDocument_status_idx" ON "SubmittedDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionSettings_schoolId_key" ON "AdmissionSettings"("schoolId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_previousBoardId_fkey" FOREIGN KEY ("previousBoardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_siblingStudentId_fkey" FOREIGN KEY ("siblingStudentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_admissionCategoryId_fkey" FOREIGN KEY ("admissionCategoryId") REFERENCES "AdmissionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorSubjectScore" ADD CONSTRAINT "PriorSubjectScore_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorSubjectScore" ADD CONSTRAINT "PriorSubjectScore_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionCategory" ADD CONSTRAINT "AdmissionCategory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequiredDocumentType" ADD CONSTRAINT "RequiredDocumentType_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedDocument" ADD CONSTRAINT "SubmittedDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedDocument" ADD CONSTRAINT "SubmittedDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedDocument" ADD CONSTRAINT "SubmittedDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedDocument" ADD CONSTRAINT "SubmittedDocument_requiredDocumentTypeId_fkey" FOREIGN KEY ("requiredDocumentTypeId") REFERENCES "RequiredDocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedDocument" ADD CONSTRAINT "SubmittedDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedDocument" ADD CONSTRAINT "SubmittedDocument_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionSettings" ADD CONSTRAINT "AdmissionSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
