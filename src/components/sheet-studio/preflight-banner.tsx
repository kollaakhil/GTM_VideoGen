"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

interface PreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checked: number;
}

export function PreflightBanner() {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/preflight/models")
      .then((r) => r.json())
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  if (loading || dismissed || !result) return null;

  // Only show if there are errors
  if (result.ok && result.errors.length === 0) return null;

  return (
    <div className="mx-6 mt-4 rounded-lg border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
            Model Validation Issues
          </div>
          <div className="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
            {result.errors.length} model{result.errors.length === 1 ? "" : "s"} failed validation out of {result.checked} checked. These issues may cause generation failures.
          </div>
          {result.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-xs font-medium text-yellow-900 dark:text-yellow-100 mb-1">Errors:</div>
              {result.errors.slice(0, 5).map((error, i) => (
                <div key={i} className="text-xs font-mono text-yellow-800 dark:text-yellow-300 pl-2 border-l-2 border-yellow-400">
                  {error}
                </div>
              ))}
              {result.errors.length > 5 && (
                <div className="text-xs text-yellow-700 dark:text-yellow-400 pl-2">
                  + {result.errors.length - 5} more error{result.errors.length - 5 === 1 ? "" : "s"}
                </div>
              )}
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="text-xs font-medium text-yellow-900 dark:text-yellow-100 mb-1">Warnings:</div>
              {result.warnings.slice(0, 3).map((warning, i) => (
                <div key={i} className="text-xs font-mono text-yellow-700 dark:text-yellow-400 pl-2 border-l-2 border-yellow-300">
                  {warning}
                </div>
              ))}
              {result.warnings.length > 3 && (
                <div className="text-xs text-yellow-600 dark:text-yellow-500 pl-2">
                  + {result.warnings.length - 3} more warning{result.warnings.length - 3 === 1 ? "" : "s"}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 text-yellow-600 dark:text-yellow-500 hover:text-yellow-800 dark:hover:text-yellow-300"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
