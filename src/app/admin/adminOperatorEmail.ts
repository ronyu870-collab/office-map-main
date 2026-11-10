'use client';

import { createContext, useContext } from 'react';

export interface AdminOperator {
  userId: string;
  email: string;
}

export const AdminOperatorContext = createContext<AdminOperator | null>(null);

export function useAdminOperator() {
  return useContext(AdminOperatorContext);
}

export function useAdminOperatorEmail() {
  return useAdminOperator()?.email ?? '';
}
