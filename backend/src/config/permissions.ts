export const permissionCodes = ['dashboard.read', 'members.read', 'members.write', 'members.archive', 'users.manage', 'profile.read', 'societies.manage', 'finance.read', 'finance.write', 'finance.approve', 'finance.settings'];
export const roleDefinitions: Record<string, { name: string; permissions: string[] }> = {
  SUPER_ADMIN: { name: 'Super Admin', permissions: permissionCodes },
  ADMIN: { name: 'Admin', permissions: ['dashboard.read', 'members.read', 'members.write', 'members.archive', 'users.manage', 'finance.read', 'finance.write', 'finance.approve', 'finance.settings'] },
  ACCOUNTANT: { name: 'Accountant', permissions: ['dashboard.read', 'members.read', 'finance.read', 'finance.write'] },
  APPROVER: { name: 'Approver', permissions: ['dashboard.read', 'members.read', 'finance.read', 'finance.approve'] },
  MEMBER: { name: 'Member', permissions: ['profile.read'] },
};
