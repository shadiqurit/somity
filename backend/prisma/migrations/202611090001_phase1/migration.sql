-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(30) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(30) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(30) NOT NULL,
    `code` VARCHAR(80) NOT NULL,

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `userId` VARCHAR(30) NOT NULL,
    `roleId` VARCHAR(30) NOT NULL,

    INDEX `user_roles_roleId_idx`(`roleId`),
    PRIMARY KEY (`userId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` VARCHAR(30) NOT NULL,
    `permissionId` VARCHAR(30) NOT NULL,

    INDEX `role_permissions_permissionId_idx`(`permissionId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_sessions` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `familyId` VARCHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_sessions_tokenHash_key`(`tokenHash`),
    INDEX `refresh_sessions_userId_revokedAt_idx`(`userId`, `revokedAt`),
    INDEX `refresh_sessions_familyId_idx`(`familyId`),
    INDEX `refresh_sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `members` (
    `id` VARCHAR(30) NOT NULL,
    `memberNo` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(30) NULL,
    `fullName` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(25) NOT NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(500) NOT NULL,
    `joinedAt` DATE NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `version` INTEGER NOT NULL DEFAULT 1,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `members_memberNo_key`(`memberNo`),
    UNIQUE INDEX `members_userId_key`(`userId`),
    UNIQUE INDEX `members_email_key`(`email`),
    INDEX `members_archivedAt_createdAt_id_idx`(`archivedAt`, `createdAt`, `id`),
    INDEX `members_archivedAt_status_idx`(`archivedAt`, `status`),
    INDEX `members_fullName_idx`(`fullName`),
    INDEX `members_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nominees` (
    `id` VARCHAR(30) NOT NULL,
    `memberId` VARCHAR(30) NOT NULL,
    `fullName` VARCHAR(120) NOT NULL,
    `relationship` VARCHAR(80) NOT NULL,
    `phone` VARCHAR(25) NOT NULL,
    `address` VARCHAR(500) NOT NULL,
    `sharePercent` DECIMAL(5, 2) NOT NULL,

    INDEX `nominees_memberId_idx`(`memberId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_documents` (
    `id` VARCHAR(30) NOT NULL,
    `memberId` VARCHAR(30) NOT NULL,
    `kind` ENUM('PHOTO', 'IDENTITY', 'OTHER') NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(80) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `member_documents_storageKey_key`(`storageKey`),
    INDEX `member_documents_memberId_kind_createdAt_idx`(`memberId`, `kind`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(30) NOT NULL,
    `actorId` VARCHAR(30) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(60) NOT NULL,
    `entityId` VARCHAR(64) NOT NULL,
    `changes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    INDEX `audit_logs_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_sessions` ADD CONSTRAINT `refresh_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nominees` ADD CONSTRAINT `nominees_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_documents` ADD CONSTRAINT `member_documents_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
