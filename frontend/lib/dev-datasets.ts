// Kept apart from dev-fixtures so the toggle can import the names without pulling the fixture data into a bundle.
export const DATASETS = ["demo", "worst", "empty", "one", "huge"] as const;
export type Dataset = (typeof DATASETS)[number];

export function isDataset(value: string | null): value is Dataset {
  return DATASETS.includes(value as Dataset);
}
