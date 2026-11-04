"use client";

import { useState } from "react";
import { api } from "@/lib/api";

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
      setName("");
      onAdded();
    } else {
      setError(`${res.status} ${res.message ?? res.code ?? "Could not add the category."}`);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <h3 className="font-semibold mb-2">Categories</h3>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {categories.map((c) => (
          <span key={c.id} className="text-xs bg-border/50 text-muted px-2 py-0.5 rounded-full">
            {c.name}
          </span>
        ))}
      </div>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder="New category name"
          className="flex-1 min-w-[180px] rounded-xl border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          disabled={pending || !name.trim()}
          className="btn-press rounded-xl bg-nus-blue px-3.5 py-2 text-sm font-semibold text-white hover:bg-nus-blue-light disabled:opacity-50"
        >
          Add category
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
