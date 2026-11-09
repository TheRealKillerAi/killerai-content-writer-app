import { useState } from "react";

/** Search box, product type filter and Search button on one row, shared by the product pickers. */
export function ProductFilters({
  q,
  type,
  types,
  go,
}: {
  q: string;
  type: string;
  types: string[];
  go: (params: Record<string, string>) => void;
}) {
  const [search, setSearch] = useState(q);
  const run = (nextType = type, nextSearch = search) => go({ ...(nextSearch ? { q: nextSearch } : {}), ...(nextType ? { type: nextType } : {}) });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
      <div style={{ flex: "1 1 240px", minWidth: 200 }}>
        <s-search-field
          label="Search products"
          labelAccessibilityVisibility="exclusive"
          placeholder="Search your products"
          value={search}
          onInput={(e) => setSearch((e.currentTarget as unknown as { value: string }).value)}
          onChange={() => run()}
        />
      </div>
      {types.length ? (
        <div style={{ flex: "0 1 220px", minWidth: 160 }}>
          <s-select
            label="Product type"
            labelAccessibilityVisibility="exclusive"
            value={type}
            onChange={(e) => run((e.currentTarget as unknown as { value: string }).value)}
          >
            <s-option value="">All types</s-option>
            {types.map((t) => (
              <s-option key={t} value={t}>{t}</s-option>
            ))}
          </s-select>
        </div>
      ) : null}
      <s-button onClick={() => run()}>Search</s-button>
    </div>
  );
}
