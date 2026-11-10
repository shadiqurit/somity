CREATE TABLE `file_deletions` (
    `storageKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER NOT NULL DEFAULT 0,
    INDEX `file_deletions_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`storageKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Retain the latest photo only, including legacy uploads. Queue the obsolete
-- files before deleting their metadata, so startup cleanup can remove the bytes.
INSERT INTO `file_deletions` (`storageKey`)
SELECT DISTINCT older.`storageKey`
FROM `member_documents` older
JOIN `member_documents` newer ON newer.`memberId` = older.`memberId`
    AND newer.`kind` = 'PHOTO'
    AND (newer.`createdAt` > older.`createdAt`
         OR (newer.`createdAt` = older.`createdAt` AND newer.`id` > older.`id`))
WHERE older.`kind` = 'PHOTO';

DELETE obsolete FROM `member_documents` obsolete
JOIN `file_deletions` pending ON pending.`storageKey` = obsolete.`storageKey`
WHERE obsolete.`kind` = 'PHOTO';
