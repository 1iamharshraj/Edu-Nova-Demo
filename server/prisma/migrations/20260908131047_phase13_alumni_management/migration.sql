-- CreateTable
CREATE TABLE "AlumniProfile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentUserId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "graduationYear" INTEGER NOT NULL,
    "lastClassLabel" TEXT,
    "currentOccupation" TEXT,
    "currentOrganization" TEXT,
    "currentCity" TEXT,
    "linkedInUrl" TEXT,
    "notes" TEXT,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlumniProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlumniEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL,
    "location" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlumniEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlumniEventRsvp" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "alumniId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Interested',
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlumniEventRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlumniDonation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "alumniId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "purpose" TEXT,
    "donatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlumniDonation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlumniProfile_schoolId_idx" ON "AlumniProfile"("schoolId");

-- CreateIndex
CREATE INDEX "AlumniProfile_studentUserId_idx" ON "AlumniProfile"("studentUserId");

-- CreateIndex
CREATE INDEX "AlumniProfile_graduationYear_idx" ON "AlumniProfile"("graduationYear");

-- CreateIndex
CREATE INDEX "AlumniEvent_schoolId_idx" ON "AlumniEvent"("schoolId");

-- CreateIndex
CREATE INDEX "AlumniEventRsvp_eventId_idx" ON "AlumniEventRsvp"("eventId");

-- CreateIndex
CREATE INDEX "AlumniEventRsvp_alumniId_idx" ON "AlumniEventRsvp"("alumniId");

-- CreateIndex
CREATE UNIQUE INDEX "AlumniEventRsvp_eventId_alumniId_key" ON "AlumniEventRsvp"("eventId", "alumniId");

-- CreateIndex
CREATE INDEX "AlumniDonation_schoolId_idx" ON "AlumniDonation"("schoolId");

-- CreateIndex
CREATE INDEX "AlumniDonation_alumniId_idx" ON "AlumniDonation"("alumniId");

-- AddForeignKey
ALTER TABLE "AlumniProfile" ADD CONSTRAINT "AlumniProfile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniProfile" ADD CONSTRAINT "AlumniProfile_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniProfile" ADD CONSTRAINT "AlumniProfile_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniEvent" ADD CONSTRAINT "AlumniEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniEvent" ADD CONSTRAINT "AlumniEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniEventRsvp" ADD CONSTRAINT "AlumniEventRsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AlumniEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniEventRsvp" ADD CONSTRAINT "AlumniEventRsvp_alumniId_fkey" FOREIGN KEY ("alumniId") REFERENCES "AlumniProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniDonation" ADD CONSTRAINT "AlumniDonation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniDonation" ADD CONSTRAINT "AlumniDonation_alumniId_fkey" FOREIGN KEY ("alumniId") REFERENCES "AlumniProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniDonation" ADD CONSTRAINT "AlumniDonation_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
