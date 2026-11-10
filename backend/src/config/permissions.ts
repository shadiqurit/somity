export const permissionCodes = ['dashboard.read', 'members.read', 'members.write', 'members.archive', 'users.manage', 'profile.read', 'societies.manage'];
export const roleDefinitions: Record<string, { name: string; permissions: string[] }> = {
  SUPER_ADMIN: { name: 'Super Admin', permissions: permissionCodes },
  ADMIN: { name: 'Admin', permissions: ['dashboard.read', 'members.read', 'members.write', 'members.archive', 'users.manage'] },
  ACCOUNTANT: { name: 'Accountant', permissions: ['dashboard.read', 'members.read'] },
  APPROVER: { name: 'Approver', permissions: ['dashboard.read', 'members.read'] },
  MEMBER: { name: 'Member', permissions: ['profile.read'] },
};
