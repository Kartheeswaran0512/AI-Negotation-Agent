/**
 * Local indexes for the two things the backend cannot list.
 *
 * The API exposes GET /api/requirements/:id but no way to list a buyer's
 * requirements, and no seller directory at all. Rather than invent endpoints,
 * the app remembers what it created on this device and looks each one up by id.
 *
 * The consequence is honest and worth showing in the UI: this index is local.
 * A requirement created on another device will not appear until its id is added
 * here, which the Home screen supports explicitly.
 */

import { readJson, writeJson } from './keyValue';

const REQUIREMENT_IDS_KEY = 'index.requirementIds';
const SELLERS_KEY = 'index.sellers';

/** A supplier the user has dealt with, remembered so ids need typing once. */
export interface KnownSeller {
  id: string;
  label: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export async function getRequirementIds(): Promise<string[]> {
  const stored = await readJson<string[]>(REQUIREMENT_IDS_KEY, []);
  return Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : [];
}

/** Newest first, so the Home screen shows the most recent work at the top. */
export async function rememberRequirementId(id: number | string): Promise<string[]> {
  const current = await getRequirementIds();
  const next = unique([String(id), ...current]);
  await writeJson(REQUIREMENT_IDS_KEY, next);
  return next;
}

export async function forgetRequirementId(id: number | string): Promise<string[]> {
  const current = await getRequirementIds();
  const next = current.filter((value) => value !== String(id));
  await writeJson(REQUIREMENT_IDS_KEY, next);
  return next;
}

export async function getKnownSellers(): Promise<KnownSeller[]> {
  const stored = await readJson<KnownSeller[]>(SELLERS_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (entry): entry is KnownSeller =>
      Boolean(entry) && typeof entry.id === 'string' && typeof entry.label === 'string',
  );
}

export async function rememberSeller(seller: KnownSeller): Promise<KnownSeller[]> {
  const current = await getKnownSellers();
  const without = current.filter((entry) => entry.id !== seller.id);
  const next = [seller, ...without];
  await writeJson(SELLERS_KEY, next);
  return next;
}

export async function forgetSeller(id: string): Promise<KnownSeller[]> {
  const current = await getKnownSellers();
  const next = current.filter((entry) => entry.id !== id);
  await writeJson(SELLERS_KEY, next);
  return next;
}
