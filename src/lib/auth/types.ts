export type AuthUser = {
  id: string;
  email: string;
  name: string;
  dob: string;
};

export type AuthSession = {
  userId: string;
  token: string;
  expiresAt: string;
};

export type StoredUser = AuthUser & {
  passwordHash: string;
};
