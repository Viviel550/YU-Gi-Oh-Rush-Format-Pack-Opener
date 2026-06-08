import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers'; // The Astro v6 / Cloudflare standard approach

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
}

// ── Fetch & cache pack card list ──────────────────────────────────────────────
// ── Fetch & cache pack card list ──────────────────────────────────────────────
async function getPackCards(packName: string): Promise<CardEntry[]> {
    // Fix: Convert all spaces to underscores to match Yugipedia's internal subobject naming convention
    const normalizedPackName = packName.replace(/ /g, '_');
    const cacheKey = `pack:${normalizedPackName}`;

    // Safety check for local environment bindings (Astro v6 standard)
    if (!env.YGO_KV) {
        throw new Error("YGO_KV is undefined. Please restart your dev server (npm run dev).");
    }

    // 1. Check KV cache using the normalized key
    const cached = await env.YGO_KV.get(cacheKey);
    if (cached) {
        return JSON.parse(cached) as CardEntry[];
    }

    // 2. Fetch from Yugipedia using the underscored name
    const query = encodeURIComponent(
        `[[-Has subobject::Set Card Lists:${normalizedPackName} (OCG-JP)]]` +
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

    const cards: CardEntry[] = Object.values(results).map((entry: any) => {
        const p = entry.printouts;
        const rawName = p['Set contains']?.[0]?.fulltext ?? '';
        const cardName = rawName.replace(/#.*$/, '').replace(/_/g, ' ').trim();

        return {
            cardName,
            cardNumber: p['Card number']?.[0] ?? '',
            rarities:   (p['Rarity'] ?? []).map((r: any) => r.fulltext),
        };
    }).filter(c => c.cardName && c.cardNumber);

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

        const results = [];

        for (const [packName, count] of Object.entries(body.packs)) {
            if (count <= 0) continue;

            const pool = await getPackCards(packName);

            for (let i = 0; i < count; i++) {
                const cards = rollCards(pool, CARDS_PER_PACK);
                results.push({
                    packName,
                    cards: cards.map(c => ({
                        cardName:   c.cardName,
                        cardNumber: c.cardNumber,
                        rarity:     c.rarities[0] ?? 'Common',
                        imgUrl: `https://yugipedia.com/Special:FilePath/${encodeURIComponent(c.cardName)}.png`,
                                        

                    })),
                });
            }
        }
        const sessionId = crypto.randomUUID();

        await env.YGO_KV.put(`session:${sessionId}`, JSON.stringify(results), {
            expirationTtl: 1800, 
        });
        // Save results to cookie so /packs can read them without re-fetching
        cookies.set('pack_opening_id', sessionId, {
            path:    '/',
            maxAge:  60 * 30, // 30 minutes
            sameSite: 'lax',
            secure: true, // Set to TRUE only if you are on https://
            //httpOnly: false // If you need to debug the cookie in JS, ensure this is fals
        });

        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error('open-packs error:', err);
        return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
    }
}