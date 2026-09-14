import React from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
export function StatusStates({ state, label, children }: { state?: 'loading' | 'empty' | 'error' | 'ready'; label: string; children?: React.ReactNode }) {
  if (state === 'loading') return <div className="flex items-center gap-2 p-4 text-xs text-text-muted" role="status"><LoaderCircle size={14} className="animate-spin" /> Loading {label}…</div>;
  if (state === 'error') return <div className="flex items-center gap-2 p-4 text-xs text-negative" role="alert"><AlertCircle size={14} /> Unable to load {label}.</div>;
  if (state === 'empty') return <div className="p-4 text-xs text-text-subtle">No {label} available.</div>;
  return <>{children}</>;
}
