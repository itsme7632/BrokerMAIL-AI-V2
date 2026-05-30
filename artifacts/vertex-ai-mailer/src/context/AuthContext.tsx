import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, LoginInput, RegisterInput, setAuthTokenGetter, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { login as apiLogin, register as apiRegister, logout as apiLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// Register the auth token getter at module load time — BEFORE any React
// Query hooks fire their first request. This eliminates the race condition
// where useGetMe fires on mount before the useEffect inside AuthProvider
// could call setAuthTokenGetter, causing 401s on page refresh.
setAuthTokenGetter(() => localStorage.getItem("auth_token"));

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginInput) => Promise<User>;
  register: (data: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(localStorage.getItem("auth_token"));
  const queryClient = useQueryClient();

  const setToken = (newToken: string | null) => {
    if (newToken) {
      localStorage.setItem("auth_token", newToken);
    } else {
      localStorage.removeItem("auth_token");
    }
    setTokenState(newToken);
  };

  const { data: user = null, isLoading, isError } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetMeQueryKey(),
    }
  });

  // If the stored token is invalid/expired (401), clear it so the user
  // is properly redirected to login instead of being stuck in a loading loop.
  useEffect(() => {
    if (isError && token) {
      setToken(null);
      queryClient.setQueryData(getGetMeQueryKey(), null);
      queryClient.clear();
    }
  }, [isError, token]);

  const login = async (data: LoginInput): Promise<User> => {
    const res = await apiLogin(data);
    setToken(res.token);
    queryClient.setQueryData(getGetMeQueryKey(), res.user);
    return res.user as User;
  };

  const register = async (data: RegisterInput): Promise<User> => {
    const res = await apiRegister(data);
    setToken(res.token);
    queryClient.setQueryData(getGetMeQueryKey(), res.user);
    return res.user as User;
  };

  const logout = async () => {
    try {
      await apiLogout();
    } finally {
      setToken(null);
      queryClient.setQueryData(getGetMeQueryKey(), null);
      queryClient.clear();
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading: isLoading && !!token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
