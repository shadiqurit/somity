-- Run during a maintenance window after backing up SQL and private uploads.

-- CreateTable
CREATE TABLE `societies` (
    `id` VARCHAR(30) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(25) NULL,
    `address` VARCHAR(500) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'BDT',
    `timezone` VARCHAR(60) NOT NULL DEFAULT 'Asia/Dhaka',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `societies_code_key`(`code`),
    INDEX `societies_isActive_name_idx`(`isActive`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `society_memberships` (
    `id` VARCHAR(30) NOT NULL,
    `societyId` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `roleId` VARCHAR(30) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `society_memberships_userId_isActive_idx`(`userId`, `isActive`),
    INDEX `society_memberships_societyId_roleId_isActive_idx`(`societyId`, `roleId`, `isActive`),
    INDEX `society_memberships_roleId_idx`(`roleId`),
    UNIQUE INDEX `society_memberships_societyId_userId_key`(`societyId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- DropForeignKey
ALTER TABLE `members` DROP FOREIGN KEY `members_userId_fkey`;

-- DropForeignKey
ALTER TABLE `nominees` DROP FOREIGN KEY `nominees_memberId_fkey`;

-- DropForeignKey
ALTER TABLE `member_documents` DROP FOREIGN KEY `member_documents_memberId_fkey`;

-- DropIndex
DROP INDEX `members_memberNo_key` ON `members`;

-- DropIndex
DROP INDEX `members_userId_key` ON `members`;

-- DropIndex
DROP INDEX `members_email_key` ON `members`;

-- DropIndex
DROP INDEX `members_archivedAt_createdAt_id_idx` ON `members`;

-- DropIndex
DROP INDEX `members_archivedAt_status_idx` ON `members`;

-- DropIndex
DROP INDEX `members_fullName_idx` ON `members`;

-- DropIndex
DROP INDEX `members_phone_idx` ON `members`;

-- DropIndex
DROP INDEX `nominees_memberId_idx` ON `nominees`;

-- DropIndex
DROP INDEX `member_documents_memberId_kind_createdAt_idx` ON `member_documents`;

-- DropIndex
DROP INDEX `audit_logs_entityType_entityId_createdAt_idx` ON `audit_logs`;

-- AlterTable
ALTER TABLE `members` ADD COLUMN `societyId` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `nominees` ADD COLUMN `societyId` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `member_documents` ADD COLUMN `societyId` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `audit_logs` ADD COLUMN `societyId` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `system_settings` DROP PRIMARY KEY,
    ADD COLUMN `societyId` VARCHAR(30) NULL;

-- CreateIndex
CREATE INDEX `members_userId_idx` ON `members`(`userId`);

-- CreateIndex
CREATE INDEX `members_societyId_archivedAt_createdAt_id_idx` ON `members`(`societyId`, `archivedAt`, `createdAt`, `id`);

-- CreateIndex
CREATE INDEX `members_societyId_archivedAt_status_idx` ON `members`(`societyId`, `archivedAt`, `status`);

-- CreateIndex
CREATE INDEX `members_societyId_fullName_idx` ON `members`(`societyId`, `fullName`);

-- CreateIndex
CREATE INDEX `members_societyId_phone_idx` ON `members`(`societyId`, `phone`);

-- CreateIndex
CREATE UNIQUE INDEX `members_societyId_id_key` ON `members`(`societyId`, `id`);

-- CreateIndex
CREATE UNIQUE INDEX `members_societyId_memberNo_key` ON `members`(`societyId`, `memberNo`);

-- CreateIndex
CREATE UNIQUE INDEX `members_societyId_email_key` ON `members`(`societyId`, `email`);

-- CreateIndex
CREATE UNIQUE INDEX `members_societyId_userId_key` ON `members`(`societyId`, `userId`);

-- CreateIndex
CREATE INDEX `nominees_societyId_memberId_idx` ON `nominees`(`societyId`, `memberId`);

-- CreateIndex
CREATE INDEX `member_documents_societyId_memberId_kind_createdAt_idx` ON `member_documents`(`societyId`, `memberId`, `kind`, `createdAt`);

-- CreateIndex
CREATE INDEX `audit_logs_societyId_entityType_entityId_createdAt_idx` ON `audit_logs`(`societyId`, `entityType`, `entityId`, `createdAt`);


-- Existing records retain their IDs and become the first society's data.
INSERT INTO `societies` (`id`, `code`, `name`, `updatedAt`)
VALUES ('legacy-society', 'DEFAULT', COALESCE((SELECT JSON_UNQUOTE(JSON_EXTRACT(`value`, '$.name')) FROM `system_settings` WHERE `key` = 'society' LIMIT 1), 'Somity'), CURRENT_TIMESTAMP(3));

UPDATE `members` SET `societyId` = 'legacy-society';
UPDATE `nominees` SET `societyId` = 'legacy-society';
UPDATE `member_documents` SET `societyId` = 'legacy-society';
UPDATE `system_settings` SET `societyId` = 'legacy-society';
UPDATE `audit_logs` SET `societyId` = 'legacy-society' WHERE `entityType` = 'member' OR `action` = 'STAFF_CREATED';

-- SUPER_ADMIN remains a platform role. All other roles become society memberships.
INSERT INTO `society_memberships` (`id`, `societyId`, `userId`, `roleId`, `isActive`, `updatedAt`)
SELECT LEFT(REPLACE(UUID(), '-', ''), 30), 'legacy-society', u.`id`,
 COALESCE((SELECT ur.`roleId` FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`roleId`
           WHERE ur.`userId` = u.`id` AND r.`code` <> 'SUPER_ADMIN'
           ORDER BY FIELD(r.`code`, 'ADMIN', 'ACCOUNTANT', 'APPROVER', 'MEMBER') LIMIT 1),
          (SELECT `id` FROM `roles` WHERE `code` = 'MEMBER' LIMIT 1)),
 u.`isActive`, CURRENT_TIMESTAMP(3)
FROM `users` u
WHERE NOT EXISTS (SELECT 1 FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`roleId` WHERE ur.`userId` = u.`id` AND r.`code` = 'SUPER_ADMIN')
   OR EXISTS (SELECT 1 FROM `members` m WHERE m.`userId` = u.`id`);
DELETE ur FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`roleId` WHERE r.`code` <> 'SUPER_ADMIN';

ALTER TABLE `members` MODIFY `societyId` VARCHAR(30) NOT NULL;
ALTER TABLE `nominees` MODIFY `societyId` VARCHAR(30) NOT NULL;
ALTER TABLE `member_documents` MODIFY `societyId` VARCHAR(30) NOT NULL;
ALTER TABLE `system_settings` MODIFY `societyId` VARCHAR(30) NOT NULL, ADD PRIMARY KEY (`societyId`, `key`);


-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_societyId_userId_fkey` FOREIGN KEY (`societyId`, `userId`) REFERENCES `society_memberships`(`societyId`, `userId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nominees` ADD CONSTRAINT `nominees_societyId_memberId_fkey` FOREIGN KEY (`societyId`, `memberId`) REFERENCES `members`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_documents` ADD CONSTRAINT `member_documents_societyId_memberId_fkey` FOREIGN KEY (`societyId`, `memberId`) REFERENCES `members`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `society_memberships` ADD CONSTRAINT `society_memberships_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `society_memberships` ADD CONSTRAINT `society_memberships_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `society_memberships` ADD CONSTRAINT `society_memberships_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
