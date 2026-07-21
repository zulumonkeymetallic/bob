import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';

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

// BOB's own human-readable refs (TK-XXXXX, ST-XXXXX, GR-XXXXX, SP-XXXXX) never collide
// with a Firestore auto-ID, so detecting the pattern lets us skip straight to the field
// query instead of paying for a doomed direct-doc-ID lookup on every deep-link click.
const REF_PATTERN = /^(TK|ST|GR|SP)-[A-Z0-9]+$/i;

async function queryByField<T extends { id: string }>(
  collectionName: 'goals' | 'stories' | 'tasks',
  field: string,
  trimmed: string,
): Promise<(T & { id: string }) | null> {
  try {
    const ownerUid = auth.currentUser?.uid;
    const colRef = collection(db, collectionName);
    const snap = await getDocs(
      ownerUid
        ? query(colRef, where(field, '==', trimmed), where('ownerUid', '==', ownerUid), limit(1))
        : query(colRef, where(field, '==', trimmed), limit(1))
    );
    if (!snap.empty) {
      const hit = snap.docs[0];
      return { id: hit.id, ...(hit.data() as T) };
    }
  } catch {
    // ignore query errors
  }
  return null;
}

async function getByDocId<T extends { id: string }>(
  collectionName: 'goals' | 'stories' | 'tasks',
  trimmed: string,
): Promise<(T & { id: string }) | null> {
  try {
    const directSnap = await getDoc(doc(db, collectionName, trimmed));
    if (directSnap.exists()) {
      return { id: directSnap.id, ...(directSnap.data() as T) };
    }
  } catch {
    // ignore doc errors
  }
  return null;
}

export async function resolveEntityByRef<T extends { id: string }>(
  collectionName: 'goals' | 'stories' | 'tasks',
  refOrId: string
): Promise<(T & { id: string }) | null> {
  const trimmed = String(refOrId || '').trim();
  if (!trimmed) return null;

  if (REF_PATTERN.test(trimmed)) {
    // Human-readable ref: query by ref first (one round trip), then the legacy
    // `reference` field, then fall back to treating it as a raw doc ID in case an
    // old ID-based link is still in circulation.
    return (await queryByField<T>(collectionName, 'ref', trimmed))
      || (await queryByField<T>(collectionName, 'reference', trimmed))
      || (await getByDocId<T>(collectionName, trimmed));
  }

  // Not ref-shaped: it's almost certainly a Firestore doc ID (old-style link).
  return (await getByDocId<T>(collectionName, trimmed))
    || (await queryByField<T>(collectionName, 'ref', trimmed))
    || (await queryByField<T>(collectionName, 'reference', trimmed));
}
