/*
  Warnings:

  - You are about to drop the column `board` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `class` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `contract` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `parentEmail` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `resignation` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `roll` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `salary` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `section` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `subjects` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `wards` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `SchoolData` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SchoolData" DROP CONSTRAINT "SchoolData_schoolId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "board",
DROP COLUMN "class",
DROP COLUMN "contract",
DROP COLUMN "parentEmail",
DROP COLUMN "resignation",
DROP COLUMN "roll",
DROP COLUMN "salary",
DROP COLUMN "section",
DROP COLUMN "subjects",
DROP COLUMN "wards";

-- DropTable
DROP TABLE "SchoolData";
