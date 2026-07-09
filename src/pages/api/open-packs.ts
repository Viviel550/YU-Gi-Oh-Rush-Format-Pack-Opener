import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import cardIdsRaw from '../../data/card_ids.json'; // adjust path to your actual data folder

// ── Rarity weights ────────────────────────────────────────────────────────────
const RARITY_WEIGHTS: Record<string, number> = {
    'Common':               650,
    'Rare':                 200,
    'Super Rare':           100,
    'Ultra Rare':            30,
    'Secret Rare':           15,
    'Over Rush Rare':         4,
    'Super Parallel Rare':    1,
    'Ultra Parallel Rare':    1,
};

const CARDS_PER_PACK = 9;
const KV_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ── Types ─────────────────────────────────────────────────────────────────────
interface CardEntry {
    cardName:   string;
    cardNumber: string;
    rarities:   string[];
    databaseId: number | null;
}

interface CardIdRecord {
    id: number;
    name: string;
}

// ── Name normalization (shared between JSON lookup and API results) ──────────
function normalizeName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s']/g, '');
}

// ── Build lookup once at module load — reused across all requests ────────────
const cardIdLookup: Map<string, number> = new Map(
    (cardIdsRaw as CardIdRecord[]).map(c => [normalizeName(c.name), c.id])
);

function resolveDatabaseId(cardName: string): number | null {
    return cardIdLookup.get(normalizeName(cardName)) ?? null;
}

// ── Fetch & cache pack card list (JP first, KR fallback) ─────────────────────
async function fetchCardsForRegion(normalizedPackName: string, region: 'OCG-JP' | 'OCG-KR'): Promise<CardEntry[]> {
    const query = encodeURIComponent(
        `[[-Has subobject::Set Card Lists:${normalizedPackName} (${region})]]` +
        `|?Card number|?Rarity|?Set contains|limit=200`
    );

    const response = await fetch(
        `https://yugipedia.com/api.php?action=ask&format=json&origin=*&query=${query}`,
        {
            headers: {
                'User-Agent': 'YGO-RushDuel-App/1.0 (272851@student.pwr.edu.pl)',
                'Accept':     'application/json',
            },
        }
    );

    if (!response.ok) throw new Error(`Yugipedia fetch failed: ${response.status}`);

    const data = await response.json();
    const results = data.query?.results ?? {};

    return Object.values(results).map((entry: any) => {
        const p = entry.printouts;
        const rawName = p['Set contains']?.[0]?.fulltext ?? '';
        const cardName = rawName.replace(/#.*$/, '').replace(/_/g, ' ').trim();
        return {
            cardName,
            cardNumber: p['Card number']?.[0] ?? '',
            rarities:   (p['Rarity'] ?? []).map((r: any) => r.fulltext),
            databaseId: resolveDatabaseId(cardName),
        };
    }).filter((c: CardEntry) => c.cardName && c.cardNumber);
}

async function getPackCards(packName: string): Promise<CardEntry[]> {
    const normalizedPackName = packName.replace(/ /g, '_');
    const cacheKey = `pack:${normalizedPackName}`;

    if (!env.YGO_KV) {
        throw new Error("YGO_KV is undefined. Please restart your dev server (npm run dev).");
    }

    // 1. Check KV cache
    /*const cached = await env.YGO_KV.get(cacheKey);
    if (cached) {
        return JSON.parse(cached) as CardEntry[];
    }*/

    // 2. Try JP list first, fall back to KR if empty
    let cards = await fetchCardsForRegion(normalizedPackName, 'OCG-JP');
    if (cards.length === 0) {
        cards = await fetchCardsForRegion(normalizedPackName, 'OCG-KR');
    }

    // 3. Save to KV with 30-day TTL
    await env.YGO_KV.put(cacheKey, JSON.stringify(cards), {
        expirationTtl: KV_TTL_SECONDS,
    });

    return cards;
}

// ── Weighted random roll ──────────────────────────────────────────────────────
function rollCards(pool: CardEntry[], count: number): CardEntry[] {
    if (pool.length === 0) return [];

    const weighted: Array<{ card: CardEntry; weight: number }> = pool.map(card => {
        const weight = Math.max(
            ...card.rarities.map(r => RARITY_WEIGHTS[r] ?? 1),
            1
        );
        return { card, weight };
    });

    const totalWeight = weighted.reduce((sum, e) => sum + e.weight, 0);
    const rolled: CardEntry[] = [];

    for (let i = 0; i < count; i++) {
        let rand = Math.random() * totalWeight;
        for (const entry of weighted) {
            rand -= entry.weight;
            if (rand <= 0) {
                rolled.push(entry.card);
                break;
            }
        }
    }

    return rolled;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function POST({ request, cookies }: APIContext) {
    try {
        const body = await request.json() as { packs: Record<string, number> };

        if (!body.packs || typeof body.packs !== 'object') {
            return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
        }

        const IMAGES_DB = env.IMAGES_DB;
        const results = [];
        const unmatchedCards: string[] = [];

        for (const [packName, count] of Object.entries(body.packs)) {
            if (count <= 0) continue;

            const pool = await getPackCards(packName);

            for (let i = 0; i < count; i++) {
                const cards = rollCards(pool, CARDS_PER_PACK);
                results.push({
                    packName,
                    cards: cards.map(c => {
                        if (c.databaseId === null) {
                            unmatchedCards.push(c.cardName);
                        }
                        return {
                            cardName:   c.cardName,
                            cardNumber: c.cardNumber,
                            rarity:     c.rarities[0] ?? 'Common',
                            databaseId: c.databaseId,
                            imgUrl: c.databaseId !== null
                                ? `${IMAGES_DB}/${c.databaseId}.jpg`
                                : null,
                        };
                    }),
                });
            }
        }

        if (unmatchedCards.length > 0) {
            console.warn('Unmatched card names (no databaseId found):', [...new Set(unmatchedCards)]);
        }

        const sessionId = crypto.randomUUID();

        await env.YGO_KV.put(`session:${sessionId}`, JSON.stringify(results), {
            expirationTtl: 1800,
        });

        cookies.set('pack_opening_id', sessionId, {
            path:    '/',
            maxAge:  60 * 30,
            sameSite: 'lax',
            secure: true,
        });

        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error('open-packs error:', err);
        return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
    }
}