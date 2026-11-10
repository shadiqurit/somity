-- CreateTable
CREATE TABLE `accounts` (
    `id` VARCHAR(30) NOT NULL,
    `societyId` VARCHAR(30) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `kind` ENUM('CASH', 'BANK', 'MEMBER_SAVINGS') NOT NULL,
    `bankName` VARCHAR(120) NULL,
    `accountNumberLast4` CHAR(4) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `accounts_societyId_id_key`(`societyId`, `id`),
    UNIQUE INDEX `accounts_societyId_code_key`(`societyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_policies` (
    `societyId` VARCHAR(30) NOT NULL,
    `requiredApprovals` INTEGER NOT NULL DEFAULT 1,
    `allowSelfApproval` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`societyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions` (
    `id` VARCHAR(30) NOT NULL,
    `societyId` VARCHAR(30) NOT NULL,
    `transactionNo` VARCHAR(40) NOT NULL,
    `type` ENUM('DEPOSIT', 'WITHDRAWAL', 'REVERSAL') NOT NULL,
    `status` ENUM('PENDING', 'POSTED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `memberId` VARCHAR(30) NOT NULL,
    `cashAccountId` VARCHAR(30) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `effectiveDate` DATE NOT NULL,
    `reference` VARCHAR(120) NOT NULL,
    `note` VARCHAR(500) NOT NULL,
    `createdById` VARCHAR(30) NOT NULL,
    `idempotencyKey` VARCHAR(80) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `policyVersion` INTEGER NOT NULL,
    `requiredApprovals` INTEGER NOT NULL,
    `allowSelfApproval` BOOLEAN NOT NULL,
    `reversalOfId` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `postedAt` DATETIME(3) NULL,

    INDEX `transactions_societyId_status_createdAt_idx`(`societyId`, `status`, `createdAt`),
    INDEX `transactions_societyId_memberId_effectiveDate_status_idx`(`societyId`, `memberId`, `effectiveDate`, `status`),
    INDEX `transactions_societyId_reversalOfId_idx`(`societyId`, `reversalOfId`),
    INDEX `transactions_societyId_cashAccountId_idx`(`societyId`, `cashAccountId`),
    INDEX `transactions_createdById_idx`(`createdById`),
    UNIQUE INDEX `transactions_societyId_id_key`(`societyId`, `id`),
    UNIQUE INDEX `transactions_societyId_transactionNo_key`(`societyId`, `transactionNo`),
    UNIQUE INDEX `transactions_societyId_idempotencyKey_key`(`societyId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transaction_entries` (
    `id` VARCHAR(30) NOT NULL,
    `societyId` VARCHAR(30) NOT NULL,
    `transactionId` VARCHAR(30) NOT NULL,
    `line` INTEGER NOT NULL,
    `accountId` VARCHAR(30) NOT NULL,
    `memberId` VARCHAR(30) NOT NULL,
    `debit` DECIMAL(20, 2) NOT NULL,
    `credit` DECIMAL(20, 2) NOT NULL,

    INDEX `transaction_entries_societyId_accountId_idx`(`societyId`, `accountId`),
    INDEX `transaction_entries_societyId_memberId_idx`(`societyId`, `memberId`),
    UNIQUE INDEX `transaction_entries_societyId_transactionId_line_key`(`societyId`, `transactionId`, `line`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_steps` (
    `id` VARCHAR(30) NOT NULL,
    `societyId` VARCHAR(30) NOT NULL,
    `transactionId` VARCHAR(30) NOT NULL,
    `step` INTEGER NOT NULL,
    `approverId` VARCHAR(30) NOT NULL,
    `decision` ENUM('APPROVE', 'REJECT') NOT NULL,
    `comment` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `approval_steps_approverId_idx`(`approverId`),
    UNIQUE INDEX `approval_steps_societyId_transactionId_step_key`(`societyId`, `transactionId`, `step`),
    UNIQUE INDEX `approval_steps_societyId_transactionId_approverId_key`(`societyId`, `transactionId`, `approverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_policies` ADD CONSTRAINT `approval_policies_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_societyId_memberId_fkey` FOREIGN KEY (`societyId`, `memberId`) REFERENCES `members`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_societyId_cashAccountId_fkey` FOREIGN KEY (`societyId`, `cashAccountId`) REFERENCES `accounts`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_societyId_reversalOfId_fkey` FOREIGN KEY (`societyId`, `reversalOfId`) REFERENCES `transactions`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `transaction_entries` ADD CONSTRAINT `transaction_entries_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction_entries` ADD CONSTRAINT `transaction_entries_societyId_transactionId_fkey` FOREIGN KEY (`societyId`, `transactionId`) REFERENCES `transactions`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction_entries` ADD CONSTRAINT `transaction_entries_societyId_accountId_fkey` FOREIGN KEY (`societyId`, `accountId`) REFERENCES `accounts`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction_entries` ADD CONSTRAINT `transaction_entries_societyId_memberId_fkey` FOREIGN KEY (`societyId`, `memberId`) REFERENCES `members`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_steps` ADD CONSTRAINT `approval_steps_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_steps` ADD CONSTRAINT `approval_steps_societyId_transactionId_fkey` FOREIGN KEY (`societyId`, `transactionId`) REFERENCES `transactions`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_steps` ADD CONSTRAINT `approval_steps_approverId_fkey` FOREIGN KEY (`approverId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Validate individual ledger rows in MySQL; the posting service enforces the
-- cross-row balance atomically. No existing Phase 1 tables/data are removed.
ALTER TABLE `transaction_entries` ADD CONSTRAINT `ledger_positive_side` CHECK ((`debit` > 0 AND `credit` = 0) OR (`credit` > 0 AND `debit` = 0));
ALTER TABLE `transactions` ADD CONSTRAINT `transaction_positive_amount` CHECK (`amount` > 0);
ALTER TABLE `transactions` ADD CONSTRAINT `transaction_approval_count` CHECK (`requiredApprovals` IN (1, 2));
ALTER TABLE `transactions` ADD CONSTRAINT `transaction_reversal_reference` CHECK ((`type` = 'REVERSAL' AND `reversalOfId` IS NOT NULL) OR (`type` <> 'REVERSAL' AND `reversalOfId` IS NULL));
ALTER TABLE `transactions` ADD CONSTRAINT `transaction_posted_time` CHECK ((`status` = 'POSTED' AND `postedAt` IS NOT NULL) OR (`status` <> 'POSTED' AND `postedAt` IS NULL));
ALTER TABLE `approval_policies` ADD CONSTRAINT `policy_approval_count` CHECK (`requiredApprovals` IN (1, 2));
ALTER TABLE `approval_steps` ADD CONSTRAINT `approval_step_range` CHECK (`step` IN (1, 2));

INSERT IGNORE INTO `permissions` (`id`, `code`) VALUES
('p2-finance-read', 'finance.read'),
('p2-finance-write', 'finance.write'),
('p2-finance-approve', 'finance.approve'),
('p2-finance-settings', 'finance.settings');

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.id, p.id FROM `roles` r CROSS JOIN `permissions` p
WHERE (r.code IN ('SUPER_ADMIN', 'ADMIN') AND p.code IN ('finance.read', 'finance.write', 'finance.approve', 'finance.settings'))
   OR (r.code = 'ACCOUNTANT' AND p.code IN ('finance.read', 'finance.write'))
   OR (r.code = 'APPROVER' AND p.code IN ('finance.read', 'finance.approve'));
