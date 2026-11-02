import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '../api/client';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'owner' | 'cashier' | 'stall_manager' | 'kitchen_staff' | 'waiter' | 'store_staff';
  phone: string | null;
  stall_id: number | null;
  stall?: {
    id: number;
    name: string;
    code: string;
  } | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  isOwner: boolean;
  isCashier: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('fc_auth_token');
    const savedUser = localStorage.getItem('fc_auth_user');

    if (savedToken && savedUser) {
      setToken(savedToken);
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('fc_auth_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('fc_auth_token', newToken);
    localStorage.setItem('fc_auth_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore network errors on logout
    } finally {
      localStorage.removeItem('fc_auth_token');
      localStorage.removeItem('fc_auth_user');
      setToken(null);
      setUser(null);
      window.location.hash = '#/login';
    }
  };

  const isOwner = user?.role === 'owner';
  const isCashier = user?.role === 'cashier' || isOwner;

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, isOwner, isCashier }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

