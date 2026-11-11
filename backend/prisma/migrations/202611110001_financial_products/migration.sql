-- AlterTable
ALTER TABLE `accounts` MODIFY `kind` ENUM('CASH', 'BANK', 'MEMBER_SAVINGS', 'LOAN_RECEIVABLE', 'INVESTMENT_ASSET', 'INVESTMENT_INCOME', 'EXPENSE') NOT NULL;

-- AlterTable
ALTER TABLE `transaction_entries` MODIFY `memberId` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `details` JSON NULL,
    ADD COLUMN `investmentId` VARCHAR(30) NULL,
    ADD COLUMN `loanId` VARCHAR(30) NULL,
    MODIFY `type` ENUM('DEPOSIT', 'WITHDRAWAL', 'REVERSAL', 'LOAN_DISBURSEMENT', 'LOAN_REPAYMENT', 'INVESTMENT_PURCHASE', 'INVESTMENT_RETURN', 'EXPENSE', 'TRANSFER') NOT NULL,
    MODIFY `memberId` VARCHAR(30) NULL;

-- CreateTable
CREATE TABLE `loans` (
    `id` VARCHAR(30) NOT NULL,
    `societyId` VARCHAR(30) NOT NULL,
    `memberId` VARCHAR(30) NOT NULL,
    `disbursementId` VARCHAR(30) NOT NULL,
    `principal` DECIMAL(20, 2) NOT NULL,
    `installmentCount` INTEGER NOT NULL,
    `firstDueDate` DATE NOT NULL,

    UNIQUE INDEX `loans_disbursementId_key`(`disbursementId`),
    INDEX `loans_societyId_memberId_idx`(`societyId`, `memberId`),
    UNIQUE INDEX `loans_societyId_id_key`(`societyId`, `id`),
    UNIQUE INDEX `loans_societyId_disbursementId_key`(`societyId`, `disbursementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investments` (
    `id` VARCHAR(30) NOT NULL,
    `societyId` VARCHAR(30) NOT NULL,
    `purchaseId` VARCHAR(30) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `counterparty` VARCHAR(120) NOT NULL,
    `principal` DECIMAL(20, 2) NOT NULL,

    UNIQUE INDEX `investments_purchaseId_key`(`purchaseId`),
    UNIQUE INDEX `investments_societyId_id_key`(`societyId`, `id`),
    UNIQUE INDEX `investments_societyId_purchaseId_key`(`societyId`, `purchaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `transactions_societyId_loanId_idx` ON `transactions`(`societyId`, `loanId`);

-- CreateIndex
CREATE INDEX `transactions_societyId_investmentId_idx` ON `transactions`(`societyId`, `investmentId`);

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_societyId_loanId_fkey` FOREIGN KEY (`societyId`, `loanId`) REFERENCES `loans`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_societyId_investmentId_fkey` FOREIGN KEY (`societyId`, `investmentId`) REFERENCES `investments`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_societyId_memberId_fkey` FOREIGN KEY (`societyId`, `memberId`) REFERENCES `members`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_societyId_disbursementId_fkey` FOREIGN KEY (`societyId`, `disbursementId`) REFERENCES `transactions`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `investments` ADD CONSTRAINT `investments_societyId_fkey` FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `investments` ADD CONSTRAINT `investments_societyId_purchaseId_fkey` FOREIGN KEY (`societyId`, `purchaseId`) REFERENCES `transactions`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `loans` ADD CONSTRAINT `loan_principal_positive` CHECK (`principal` > 0);
ALTER TABLE `loans` ADD CONSTRAINT `loan_installment_range` CHECK (`installmentCount` BETWEEN 1 AND 600);
ALTER TABLE `investments` ADD CONSTRAINT `investment_principal_positive` CHECK (`principal` > 0);
-- Required member ownership for savings/loan transaction types is enforced by
-- the validated submission/posting service. MySQL does not permit a CHECK on
-- this column while its existing composite FK uses ON UPDATE CASCADE.
