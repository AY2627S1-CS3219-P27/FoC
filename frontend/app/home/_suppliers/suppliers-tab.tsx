"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authFetch } from "@/lib/api";
import { pulseNavigation } from "@/lib/nav-pulse";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/field";
import { BuildingIcon, FlagIcon, PlusIcon, SearchIcon, StoreIcon } from "@/components/ui/icons";
import { EmptyState, IconTile, List, ListRow, PageHeader, Pill, Section, SkeletonList } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/sheet";
import { CategoriesPanel } from "../_admin/categories-panel";
import { SupplierStatusControl } from "../_admin/supplier-status-control";
import type { BuildingItem, CategoryItem, SupplierItem } from "../_shared/types";
import { MyRequests } from "./my-requests";
import { SupplierForm } from "./supplier-form";

const MAX_ROW_CATEGORIES = 3;

const KIND_STYLE: Record<string, { color: string; Icon: typeof StoreIcon }> = {
  Store: { color: "var(--nus-orange)", Icon: StoreIcon },
  Facility: { color: "var(--nus-blue-light)", Icon: BuildingIcon },
  Landmark: { color: "#8e8e93", Icon: FlagIcon },
};

function KindTile({ kind, size = 30 }: { kind: string; size?: number }) {
  const { color, Icon } = KIND_STYLE[kind] ?? KIND_STYLE.Landmark;
  return (
    <IconTile color={color} size={size}>
      <Icon size={Math.round(size * 0.56)} />
    </IconTile>
  );
}

type Panel = "add" | "categories" | "suggest" | "mine";

const PANEL_TITLES: Record<Panel, string> = {
  add: "Add supplier",
  categories: "Categories",
  suggest: "Suggest a supplier",
  mine: "My requests",
};

export function SuppliersTab({
  suppliers,
  buildings,
  categories,
  loading,
  searchName,
  setSearchName,
  filterBuilding,
  setFilterBuilding,
  filterKind,
  setFilterKind,
  isAdmin,
  onSuppliersChanged,
  onCategoriesChanged,
  footer,
}: {
  suppliers: SupplierItem[];
  buildings: BuildingItem[];
  categories: CategoryItem[];
  loading: boolean;
  searchName: string;
  setSearchName: (v: string) => void;
  filterBuilding: string;
  setFilterBuilding: (v: string) => void;
  filterKind: string;
  setFilterKind: (v: string) => void;
  isAdmin: boolean;
  onSuppliersChanged: () => void;
  onCategoriesChanged: () => void;
  footer: React.ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [requestsVersion, setRequestsVersion] = useState(0);
  const selected = suppliers.find((s) => s.id === selectedId);
  const filtered = !!(searchName || filterBuilding || filterKind);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Campus pickup points for your errands"
        actions={
          isAdmin ? (
            <>
              <Button intent="outline" size="sm" onClick={() => setPanel("categories")}>
                Categories
              </Button>
              <Button size="sm" onClick={() => setPanel("add")}>
                <PlusIcon size={15} strokeWidth={2.5} />
                Add
              </Button>
            </>
          ) : (
            <>
              <Button intent="outline" size="sm" onClick={() => setPanel("mine")}>
                My requests
              </Button>
              <Button size="sm" onClick={() => setPanel("suggest")}>
                <PlusIcon size={15} strokeWidth={2.5} />
                Suggest
              </Button>
            </>
          )
        }
      />

      <label className="relative mb-3 block">
        <span className="sr-only">Search suppliers</span>
        <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          type="search"
          placeholder="Search"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          className="h-10 w-full rounded-[10px] border-0 bg-fill pr-3 pl-9 text-[17px] text-foreground placeholder:text-muted"
        />
      </label>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
        <FilterSelect label="Building" value={filterBuilding} onChange={(e) => setFilterBuilding(e.target.value)}>
          <option value="">All buildings</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.shortName}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Type" value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
          <option value="">All types</option>
          <option value="Store">Stores</option>
          <option value="Facility">Facilities</option>
          <option value="Landmark">Landmarks</option>
        </FilterSelect>
      </div>

      {loading ? (
        <SkeletonList />
      ) : suppliers.length === 0 ? (
        <EmptyState
          title="No suppliers"
          body={filtered ? "Nothing matches your search and filters." : "Check that the supplier service is running."}
          action={
            filtered && (
              <Button
                intent="tinted"
                size="sm"
                onClick={() => {
                  setSearchName("");
                  setFilterBuilding("");
                  setFilterKind("");
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <>
          <List className="stagger">
            {suppliers.map((s) => {
              const extra = s.categories.length - MAX_ROW_CATEGORIES;
              const cats = s.categories.slice(0, MAX_ROW_CATEGORIES).map((c) => c.name).join(", ");
              return (
                <ListRow
                  key={s.id}
                  leading={<KindTile kind={s.kind} />}
                  title={<span className="line-clamp-2 font-medium">{s.displayName}</span>}
                  subtitle={
                    <>
                      {/* The floor is short and the useful part, so the building name gives way first. */}
                      <span className="flex min-w-0">
                        <span className="truncate">{s.building?.shortName ?? "—"}</span>
                        <span className="shrink-0 whitespace-pre"> · Floor {s.floor}</span>
                      </span>
                      {cats && (
                        <span className="block truncate">
                          {cats}
                          {extra > 0 && ` +${extra}`}
                        </span>
                      )}
                    </>
                  }
                  trailing={s.status !== "Active" && <Pill tone="danger" className="shrink-0">{s.status}</Pill>}
                  onClick={() => setSelectedId(s.id)}
                />
              );
            })}
          </List>
          {footer}
        </>
      )}

      {selected && (
        <SupplierSheet
          key={selected.id}
          supplier={selected}
          onClose={() => setSelectedId(null)}
          isAdmin={isAdmin}
          onStatusChanged={onSuppliersChanged}
          buildings={buildings}
          categories={categories}
          onSaved={(message) => {
            toast.success(message);
            if (!isAdmin) setRequestsVersion((v) => v + 1);
            onSuppliersChanged();
          }}
        />
      )}

      {panel && (
        <Sheet title={PANEL_TITLES[panel]} wide={panel === "categories"} onClose={() => setPanel(null)}>
          {(close) =>
            panel === "categories" ? (
              <CategoriesPanel categories={categories} onAdded={onCategoriesChanged} />
            ) : panel === "mine" ? (
              <MyRequests
                reloadKey={requestsVersion}
                supplierName={(id) => suppliers.find((s) => s.id === id)?.displayName}
              />
            ) : (
              <SupplierForm
                mode={panel === "add" ? "admin-create" : "request-create"}
                buildings={buildings}
                categories={categories}
                onDone={(message) => {
                  toast.success(message);
                  setRequestsVersion((v) => v + 1);
                  onSuppliersChanged();
                  close();
                }}
              />
            )
          }
        </Sheet>
      )}
    </div>
  );
}

// A supplier's details; editing pushes a form inside the same sheet, with Back to return.
function SupplierSheet({
  supplier,
  onClose,
  isAdmin,
  onStatusChanged,
  buildings,
  categories,
  onSaved,
}: {
  supplier: SupplierItem;
  onClose: () => void;
  isAdmin: boolean;
  onStatusChanged: () => void;
  buildings: BuildingItem[];
  categories: CategoryItem[];
  onSaved: (message: string) => void;
}) {
  const [location, setLocation] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    authFetch(`/api/suppliers/${supplier.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { locationDescription?: string } | null) => setLocation(d?.locationDescription ?? null))
      .catch(() => setLocation(null));
  }, [supplier.id, saved]);

  const editTitle = isAdmin ? "Edit supplier" : "Suggest a change";

  return (
    <Sheet
      title={editing ? editTitle : supplier.displayName}
      description={editing ? supplier.displayName : undefined}
      onClose={onClose}
      onBack={editing ? () => setEditing(false) : undefined}
      backLabel="Details"
    >
      {editing ? (
        <div key="edit" className="push-enter">
          <SupplierForm
            mode={isAdmin ? "admin-edit" : "request-update"}
            supplierId={supplier.id}
            buildings={buildings}
            categories={categories}
            onDone={(message) => {
              setEditing(false);
              setSaved((n) => n + 1);
              onSaved(message);
            }}
          />
        </div>
      ) : (
        <div key="details" className="pop-enter space-y-6">
          <div className="flex flex-col items-center pt-1 text-center">
            <KindTile kind={supplier.kind} size={60} />
            <p className="mt-3 text-[22px] leading-tight font-bold break-words">{supplier.displayName}</p>
            <p className="mt-1 text-[15px] text-muted">
              {supplier.kind}
              {supplier.status !== "Active" && <span className="text-danger"> · {supplier.status}</span>}
            </p>
          </div>

          <Section title="Location">
            <ul className="pl-4 [&>li+li>div]:border-t">
              {(
                [
                  ["Building", supplier.building?.shortName ?? "—"],
                  ["Floor", supplier.floor],
                  ["Where exactly", location ?? "—"],
                ] as const
              ).map(([label, value]) => (
                <li key={label}>
                  <div className="border-border py-2.5 pr-4">
                    <p className="text-[13px] text-muted">{label}</p>
                    <p className="mt-0.5 text-[15px] break-words">{value}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Categories">
            <div className="flex flex-wrap gap-1.5 p-4">
              {supplier.categories.length === 0 && <span className="text-[15px] text-muted">None</span>}
              {supplier.categories.map((c) => (
                <Pill key={c.id} tone="orange" className="text-[13px]">
                  {c.name}
                </Pill>
              ))}
            </div>
          </Section>

          {isAdmin && (
            <SupplierStatusControl supplierId={supplier.id} status={supplier.status} onChanged={onStatusChanged} />
          )}

          <List>
            <ListRow
              title={editTitle}
              tone="tint"
              onClick={() => {
                pulseNavigation("forward");
                setEditing(true);
              }}
            />
          </List>
        </div>
      )}
    </Sheet>
  );
}
