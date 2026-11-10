-- Cross-row nominee totals are validated by the member service, inside the same
-- transaction that replaces nominees. These constraints additionally protect rows.
ALTER TABLE `nominees` ADD CONSTRAINT `nominees_share_range` CHECK (`sharePercent` > 0 AND `sharePercent` <= 100);
ALTER TABLE `member_documents` ADD CONSTRAINT `member_documents_size_positive` CHECK (`sizeBytes` > 0);
ALTER TABLE `members` ADD CONSTRAINT `members_version_positive` CHECK (`version` > 0);
