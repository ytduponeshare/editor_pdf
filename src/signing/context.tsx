import { createContext, useContext } from 'react';
import type { FieldDefinition } from '../editor/types';

export interface SigningContextValue {
  contractId?: string;
  userId?: string;
  roleId: string;
  fields: Record<string, FieldDefinition>;
  values: Record<string, string>;
  signatures: Record<string, string>;
  seals: Record<string, string>;
  tableValues: Record<string, string>;
  invalidFieldIds: Set<string>;
  setValue: (fieldId: string, value: string) => void;
  setSignature: (fieldId: string, dataUrl?: string) => void;
  setSeal: (fieldId: string, dataUrl?: string) => void;
  setTableValue: (key: string, value: string) => void;
}

export const SigningContext = createContext<SigningContextValue | null>(null);

export function useSigningContext(): SigningContextValue | null {
  return useContext(SigningContext);
}
