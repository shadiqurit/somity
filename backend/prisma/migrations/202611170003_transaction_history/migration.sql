ALTER TABLE `transactions`
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD INDEX `transactions_visible_history_idx` (`societyId`, `deletedAt`, `createdAt`, `id`),
  ADD INDEX `transactions_status_history_idx` (`societyId`, `status`, `deletedAt`, `createdAt`, `id`),
  ADD INDEX `transactions_type_history_idx` (`societyId`, `type`, `deletedAt`, `createdAt`, `id`),
  DROP INDEX `transactions_societyId_status_createdAt_idx`;

ALTER TABLE `audit_logs`
  ADD INDEX `audit_logs_entity_history_idx` (`societyId`, `entityType`, `entityId`, `createdAt`, `id`),
  ADD INDEX `audit_logs_society_history_idx` (`societyId`, `entityType`, `createdAt`, `id`),
  ADD INDEX `audit_logs_action_history_idx` (`societyId`, `entityType`, `action`, `createdAt`, `id`),
  DROP INDEX `audit_logs_societyId_entityType_entityId_createdAt_idx`;

INSERT IGNORE INTO `permissions` (`id`, `code`) VALUES ('finance-delete-permission', 'finance.delete');
INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`code` IN ('SUPER_ADMIN', 'ADMIN', 'SOCIETY_ADMIN') AND p.`code` = 'finance.delete';
