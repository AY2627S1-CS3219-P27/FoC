"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
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
      setError(errorText(res, "Could not add the category."));
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={add}>
        <h2 className="section-label mb-1.5 px-4">Add a category</h2>
        <div className="flex gap-2 rounded-2xl bg-surface p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            placeholder="New category name"
            aria-label="New category name"
            className={`min-w-0 flex-1 ${inputClass}`}
          />
          <Button type="submit" disabled={pending || !name.trim()}>
            Add
          </Button>
        </div>
        {error && (
          <div className="mt-2 px-4">
            <FormError>{error}</FormError>
          </div>
        )}
      </form>

      <section>
        <h2 className="section-label mb-1.5 px-4">
          {categories.length} {categories.length === 1 ? "category" : "categories"}
        </h2>
        <div className="flex flex-wrap gap-1.5 rounded-2xl bg-surface p-4">
          {categories.length === 0 && <p className="text-[13px] text-muted">No categories yet.</p>}
          {categories.map((c) => (
            <Pill key={c.id} className="text-[13px]">
              {c.name}
            </Pill>
          ))}
        </div>
      </section>
    </div>
  );
}
