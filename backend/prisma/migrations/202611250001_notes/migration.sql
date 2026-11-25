CREATE TABLE `notes` (
  `id` VARCHAR(30) NOT NULL,
  `societyId` VARCHAR(30) NOT NULL,
  `category` ENUM('MEMBER', 'LOAN', 'DUES', 'BUSINESS', 'INVESTMENT', 'OTHER') NOT NULL DEFAULT 'OTHER',
  `title` VARCHAR(160) NOT NULL,
  `content` TEXT NOT NULL,
  `memberId` VARCHAR(30) NULL,
  `createdById` VARCHAR(30) NOT NULL,
  `updatedById` VARCHAR(30) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `notes_society_created_idx` (`societyId`, `createdAt`, `id`),
  INDEX `notes_society_category_idx` (`societyId`, `category`, `createdAt`, `id`),
  INDEX `notes_society_member_idx` (`societyId`, `memberId`),
  INDEX `notes_created_by_idx` (`createdById`),
  PRIMARY KEY (`id`),
  CONSTRAINT `notes_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notes_societyId_memberId_fkey` FOREIGN KEY (`societyId`, `memberId`) REFERENCES `members`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notes_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notes_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`, `code`) VALUES
  ('notes-read-permission', 'notes.read'),
  ('notes-write-permission', 'notes.write'),
  ('notes-delete-permission', 'notes.delete');

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`code` IN ('SUPER_ADMIN', 'ADMIN', 'SOCIETY_ADMIN')
  AND p.`code` IN ('notes.read', 'notes.write', 'notes.delete');
