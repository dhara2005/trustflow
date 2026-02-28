import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { cid, escrowId } = req.query;
    const jwt = process.env.PINATA_JWT;

    // Mode 1: Fetch by CID directly
    if (cid && typeof cid === 'string') {
        return fetchByCid(cid, res);
    }

    // Mode 2: Search by escrowId via Pinata pin listing
    if (escrowId && typeof escrowId === 'string') {
        if (!jwt) {
            return res.status(500).json({ error: 'PINATA_JWT not configured' });
        }
        return fetchByEscrowId(escrowId, jwt, res);
    }

    return res.status(400).json({ error: 'Missing cid or escrowId parameter' });
}

async function fetchByCid(cid: string, res: VercelResponse) {
    try {
        const gateways = [
            `https://gateway.pinata.cloud/ipfs/${cid}`,
            `https://ipfs.io/ipfs/${cid}`,
            `https://cloudflare-ipfs.com/ipfs/${cid}`,
        ];

        let data = null;
        for (const gateway of gateways) {
            try {
                const response = await fetch(gateway, {
                    headers: { Accept: 'application/json' },
                    signal: AbortSignal.timeout(8000),
                });
                if (response.ok) {
                    data = await response.json();
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!data) {
            return res.status(404).json({ error: 'Submission not found on IPFS' });
        }

        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
        return res.status(200).json(data);
    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}

async function fetchByEscrowId(escrowId: string, jwt: string, res: VercelResponse) {
    try {
        // Search Pinata for pins matching this escrowId
        const searchUrl = `https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=trustflow_submission_${escrowId}&pageLimit=1&sortBy=date_pinned&sortOrder=DESC`;

        const pinataRes = await fetch(searchUrl, {
            headers: { Authorization: `Bearer ${jwt}` },
            signal: AbortSignal.timeout(10000),
        });

        if (!pinataRes.ok) {
            console.error('Pinata search failed:', await pinataRes.text());
            return res.status(502).json({ error: 'Failed to search IPFS' });
        }

        const pinataData = await pinataRes.json();
        const rows = pinataData.rows || [];

        if (rows.length === 0) {
            return res.status(404).json({ error: 'No submission found for this escrow' });
        }

        // Fetch the most recent submission by CID
        const latestCid = rows[0].ipfs_pin_hash;
        return fetchByCid(latestCid, res);
    } catch (err: any) {
        console.error('Search error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
