'use client';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return <button type="button" className="copy" aria-live="polite" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}>
    {copied ? <Check aria-hidden="true" strokeWidth={2} /> : <Copy aria-hidden="true" strokeWidth={1.75} />}
    <span>{copied ? done : label}</span>
  </button>;
}
