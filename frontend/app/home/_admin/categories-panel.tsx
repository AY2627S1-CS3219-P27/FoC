"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/field";
import { Pill } from "@/components/ui/layout";

export function CategoriesPanel({
  categories,
  onAdded,
}: {
  categories: { id: string; name: string }[];
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    const res = await api("POST", "/api/categories", { body: { name: name.trim() } });
    setPending(false);
    if (res.ok) {
      toast.success(`Added “${name.trim()}”`);
      setName("");
      onAdded();
    } else {
      setError(`${res.status} ${res.message ?? res.code ?? "Could not add the category."}`);
    }
  }

  return (
    <div className="fade-in mb-6 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h2 className="mb-3 font-semibold">Categories</h2>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {categories.length === 0 && <p className="text-sm text-muted">No categories yet.</p>}
        {categories.map((c) => (
          <Pill key={c.id}>{c.name}</Pill>
        ))}
      </div>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder="New category name"
          aria-label="New category name"
          className={`min-w-[180px] flex-1 ${inputClass}`}
        />
        <Button type="submit" intent="secondary" disabled={pending || !name.trim()}>
          Add category
        </Button>
      </form>
      {error && (
        <div className="mt-2">
          <FormError>{error}</FormError>
        </div>
      )}
    </div>
  );
}
