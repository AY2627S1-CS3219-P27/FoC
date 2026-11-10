import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const DEBOUNCE_MS = 300;

export type Sufficiency = "idle" | "checking" | "sufficient" | "insufficient" | "error";

interface Response {
  userId: string;
  amount: number;
  sufficient: boolean;
}

// Asks credit-service whether `amount` more credits are available. null = nothing to check.
export function useCreditSufficiency(userId: string, amount: number | null): Sufficiency {
  const [result, setResult] = useState<{ amount: number; status: "sufficient" | "insufficient" | "error" } | null>(null);

  useEffect(() => {
    if (amount === null) return;
    let active = true;
    const timer = setTimeout(() => {
      void api<Response>("POST", "/api/credits/sufficiency", { body: { userId, amount } }).then((res) => {
        if (!active) return;
        const valid = res.ok && res.data && res.data.userId === userId && res.data.amount === amount;
        setResult({ amount, status: !valid ? "error" : res.data!.sufficient ? "sufficient" : "insufficient" });
      });
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [amount, userId]);

  if (amount === null) return "idle";
  return result?.amount === amount ? result.status : "checking";
}
