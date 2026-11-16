START TRANSACTION;

INSERT IGNORE INTO `roles` (`id`, `code`, `name`) VALUES
  ('society-admin-role', 'SOCIETY_ADMIN', 'Society Admin'),
  ('platform-admin-role', 'ADMIN', 'Admin');

-- Existing Admin memberships retain their society scope.
UPDATE `society_memberships` m
JOIN `roles` old_role ON old_role.`id` = m.`roleId` AND old_role.`code` = 'ADMIN'
JOIN `roles` society_role ON society_role.`code` = 'SOCIETY_ADMIN'
SET m.`roleId` = society_role.`id`;

DELETE rp FROM `role_permissions` rp
JOIN `roles` r ON r.`id` = rp.`roleId` AND r.`code` = 'ADMIN'
JOIN `permissions` p ON p.`id` = rp.`permissionId`
WHERE p.`code` NOT IN ('dashboard.read', 'members.read', 'finance.read', 'finance.write', 'finance.approve', 'finance.settings');

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE (r.`code` IN ('ADMIN', 'SOCIETY_ADMIN') AND p.`code` IN ('dashboard.read', 'members.read', 'finance.read', 'finance.write', 'finance.approve', 'finance.settings'))
   OR (r.`code` = 'SOCIETY_ADMIN' AND p.`code` IN ('members.write', 'members.archive', 'users.manage'));

COMMIT;
