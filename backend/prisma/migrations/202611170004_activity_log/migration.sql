ALTER TABLE `audit_logs`
  ADD COLUMN `actorRole` VARCHAR(40) NULL,
  ADD INDEX `audit_logs_activity_idx` (`societyId`, `createdAt`, `id`),
  ADD INDEX `audit_logs_activity_action_idx` (`societyId`, `action`, `createdAt`, `id`),
  ADD INDEX `audit_logs_activity_role_idx` (`societyId`, `actorRole`, `createdAt`, `id`);

INSERT IGNORE INTO `permissions` (`id`, `code`) VALUES ('activity-read-permission', 'activity.read');
INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`code` IN ('SUPER_ADMIN', 'ADMIN', 'SOCIETY_ADMIN') AND p.`code` = 'activity.read';
