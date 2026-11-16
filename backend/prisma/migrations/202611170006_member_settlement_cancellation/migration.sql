ALTER TABLE `member_settlements`
  ADD COLUMN `cancelledAt` DATETIME(3) NULL,
  ADD COLUMN `isCurrent` BOOLEAN NULL DEFAULT TRUE,
  ADD UNIQUE INDEX `member_settlements_current_key` (`societyId`, `memberId`, `isCurrent`),
  DROP INDEX `member_settlements_member_key`;
