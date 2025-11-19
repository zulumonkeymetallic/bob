import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';

export type EntityLookupType = 'goal' | 'story';

export interface EntitySummary {
  id: string;
  title: string;
  ref?: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; rows: EntitySummary[] }>();

async function ensureCache(type: EntityLookupType, ownerUid: string): Promise<EntitySummary[]> {
  const key = `${type}:${ownerUid}`;
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.rows;
  }
  const collectionName = type === 'goal' ? 'goals' : 'stories';
  const snapshot = await getDocs(
    query(collection(db, collectionName), where('ownerUid', '==', ownerUid), limit(200))
  );
  const rows: EntitySummary[] = snapshot.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      title: data.title || data.name || '(untitled)',
      ref: data.ref || null,
    };
  });
  cache.set(key, { fetchedAt: Date.now(), rows });
  return rows;
}

export function formatEntityLabel(entity?: EntitySummary | null): string {
  if (!entity) return '';
  const refPart = entity.ref ? `${entity.ref} · ` : '';
  return `${refPart}${entity.title || '(untitled)'}`;
}

export async function searchEntities(
  type: EntityLookupType,
  ownerUid: string,
  term: string,
  maxResults = 15
): Promise<EntitySummary[]> {
  if (!ownerUid) return [];
  const normalizedTerm = term?.trim().toLowerCase();
  if (!normalizedTerm || normalizedTerm.length < 3) return [];
  const rows = await ensureCache(type, ownerUid);
  return rows
    .filter((row) => {
      const title = row.title?.toLowerCase() || '';
      const ref = row.ref?.toLowerCase() || '';
      return title.includes(normalizedTerm) || ref.includes(normalizedTerm);
    })
    .slice(0, maxResults);
}

export async function loadEntitySummary(type: EntityLookupType, id: string): Promise<EntitySummary | null> {
  if (!id) return null;
  try {
    const collectionName = type === 'goal' ? 'goals' : 'stories';
    const snap = await getDoc(doc(db, collectionName, id));
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    return {
      id: snap.id,
      title: data.title || data.name || '(untitled)',
      ref: data.ref || null,
    };
  } catch {
    return null;
  }
}

export async function resolveEntityByRef<T extends { id: string }>(
  collectionName: 'goals' | 'stories' | 'tasks',
  refOrId: string
): Promise<(T & { id: string }) | null> {
  const trimmed = String(refOrId || '').trim();
  if (!trimmed) return null;

  // Attempt direct document lookup first
  try {
    const directSnap = await getDoc(doc(db, collectionName, trimmed));
    if (directSnap.exists()) {
      return { id: directSnap.id, ...(directSnap.data() as T) };
    }
  } catch {
    // ignore doc errors
  }

  // Fall back to querying by ref/reference fields
  try {
    const refs = ['ref', 'reference'];
    for (const field of refs) {
      const snap = await getDocs(
        query(
          collection(db, collectionName),
          where(field, '==', trimmed),
          limit(1)
        )
      );
      if (!snap.empty) {
        const hit = snap.docs[0];
        return { id: hit.id, ...(hit.data() as T) };
      }
    }
  } catch {
    // ignore query errors
  }

  return null;
}
