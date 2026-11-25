-- CreateTable
CREATE TABLE `non_member_borrowers` (
    `id` VARCHAR(30) NOT NULL,
    `societyId` VARCHAR(30) NOT NULL,
    `borrowerNo` VARCHAR(32) NOT NULL,
    `fullName` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(25) NOT NULL,
    `identityNumber` VARCHAR(40) NULL,
    `address` VARCHAR(500) NOT NULL DEFAULT '',
    `guarantorName` VARCHAR(120) NULL,
    `guarantorPhone` VARCHAR(25) NULL,
    `note` VARCHAR(500) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `non_member_borrowers_societyId_id_key`(`societyId`, `id`),
    UNIQUE INDEX `non_member_borrowers_societyId_borrowerNo_key`(`societyId`, `borrowerNo`),
    INDEX `non_member_borrowers_societyId_isActive_fullName_idx`(`societyId`, `isActive`, `fullName`),
    INDEX `non_member_borrowers_societyId_phone_idx`(`societyId`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `transactions`
    ADD COLUMN `borrowerId` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `loans`
    MODIFY `memberId` VARCHAR(30) NULL,
    ADD COLUMN `borrowerId` VARCHAR(30) NULL;

-- CreateIndex
CREATE INDEX `transactions_societyId_borrowerId_idx` ON `transactions`(`societyId`, `borrowerId`);

-- CreateIndex
CREATE INDEX `loans_societyId_borrowerId_idx` ON `loans`(`societyId`, `borrowerId`);

-- AddForeignKey
ALTER TABLE `non_member_borrowers`
    ADD CONSTRAINT `non_member_borrowers_societyId_fkey`
    FOREIGN KEY (`societyId`) REFERENCES `societies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions`
    ADD CONSTRAINT `transactions_societyId_borrowerId_fkey`
    FOREIGN KEY (`societyId`, `borrowerId`) REFERENCES `non_member_borrowers`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `loans`
    ADD CONSTRAINT `loans_societyId_borrowerId_fkey`
    FOREIGN KEY (`societyId`, `borrowerId`) REFERENCES `non_member_borrowers`(`societyId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
