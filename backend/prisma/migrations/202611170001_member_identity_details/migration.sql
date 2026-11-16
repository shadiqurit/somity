ALTER TABLE `members`
  ADD COLUMN `identityNumber` VARCHAR(40) NULL,
  ADD COLUMN `dateOfBirth` DATE NULL,
  ADD COLUMN `nationality` VARCHAR(120) NULL,
  ADD COLUMN `permanentAddress` VARCHAR(500) NULL;

ALTER TABLE `nominees` ADD COLUMN `identityNumber` VARCHAR(40) NULL;
