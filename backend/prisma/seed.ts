import 'dotenv/config';
import { z } from 'zod';
import { emailSchema, passwordSchema } from '../src/modules/auth/auth.validator.js';
import { hashPassword } from '../src/utils/password.js';
import { syncRoles } from '../src/services/roles.js';
import { db } from '../src/config/database.js';
async function main() {
  const email = emailSchema.parse(process.env.SEED_ADMIN_EMAIL);
  const name = z.string().min(2).max(120).parse(process.env.SEED_ADMIN_NAME ?? 'Super Administrator');
  const existing = await db.user.findUnique({ where: { email } });
  // Never reset an existing user's password or elevate an existing account.
  const passwordHash = existing ? null : await hashPassword(passwordSchema.parse(process.env.SEED_ADMIN_PASSWORD));
  await db.$transaction(async tx => {
    await syncRoles(tx);
    if (passwordHash) {
      const role = await tx.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
      const user = await tx.user.create({ data: { email, name, passwordHash, mustChangePassword: true, roles: { create: { roleId: role.id } } } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'SUPERADMIN_SEEDED', entityType: 'user', entityId: user.id } });
    }
    const society = await tx.society.upsert({ where: { code: 'DEFAULT' }, update: {}, create: { id: 'legacy-society', code: 'DEFAULT', name: 'Somity' } });
    await tx.systemSetting.upsert({ where: { societyId_key: { societyId: society.id, key: 'society' } }, update: {}, create: { societyId: society.id, key: 'society', value: { currency: 'BDT', timezone: 'Asia/Dhaka', locale: 'en-BD' } } });
  });
  console.log(existing ? 'Roles synchronized. Existing account left unchanged.' : `Superadmin created: ${email}. Change the initial password on first sign-in.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
