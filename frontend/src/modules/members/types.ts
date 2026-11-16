export interface Nominee {
  fullName: string;
  identityNumber: string | null;
  relationship: string;
  phone: string;
  address: string;
  sharePercent: string;
}

export interface Member {
  id: string;
  memberNo: string;
  fullName: string;
  phone: string;
  email: string | null;
  identityNumber: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  address: string;
  permanentAddress: string | null;
  status: string;
  joinedAt: string;
  version: number;
  nominees: Nominee[];
  documents: { id: string }[];
  user: { id: string; email: string; isActive: boolean } | null;
}
export const statusOptions = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'CLOSED', label: 'Closed' },
];
