export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  roles: string[];
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
};

export type AuthResponse = {
  user: AuthUser;
  tokens: AuthTokens;
};
