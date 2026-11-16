CREATE TABLE `member_settlements` (
  `id` VARCHAR(30) NOT NULL,
  `societyId` VARCHAR(30) NOT NULL,
  `memberId` VARCHAR(30) NOT NULL,
  `dues` JSON NOT NULL,
  `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `member_settlements_member_key` (`societyId`, `memberId`),
  UNIQUE INDEX `member_settlements_scope_key` (`societyId`, `memberId`, `id`),
  CONSTRAINT `member_settlements_societyId_memberId_fkey`
    FOREIGN KEY (`societyId`, `memberId`) REFERENCES `members` (`societyId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `transactions`
  ADD COLUMN `settlementId` VARCHAR(30) NULL,
  ADD INDEX `transactions_settlement_idx` (`societyId`, `memberId`, `settlementId`),
  ADD CONSTRAINT `transactions_settlement_fkey` FOREIGN KEY (`societyId`, `memberId`, `settlementId`)
    REFERENCES `member_settlements` (`societyId`, `memberId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
