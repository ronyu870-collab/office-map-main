'use client';

import { createContext, useContext } from 'react';

export const AdminOperatorEmailContext = createContext('');

export function useAdminOperatorEmail() {
  return useContext(AdminOperatorEmailContext);
}
