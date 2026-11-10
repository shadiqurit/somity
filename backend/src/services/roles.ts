import type { Prisma } from '@prisma/client';
import { permissionCodes, roleDefinitions } from '../config/permissions.js';
export async function syncRoles(tx: Prisma.TransactionClient) {
  for (const code of permissionCodes) await tx.permission.upsert({ where: { code }, update: {}, create: { code } });
  for (const [code, definition] of Object.entries(roleDefinitions)) {
    const role = await tx.role.upsert({ where: { code }, update: { name: definition.name }, create: { code, name: definition.name } });
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const permissionCode of definition.permissions) {
      const permission = await tx.permission.findUniqueOrThrow({ where: { code: permissionCode } });
      await tx.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
  }
}
