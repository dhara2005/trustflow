import type { VercelRequest, VercelResponse } from '@vercel/node';

const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { cid, escrowId } = req.query;
    const jwt = process.env.PINATA_JWT;

    if (cid && typeof cid === 'string') {
        return fetchByCid(cid, jwt, res);
    }

    if (escrowId && typeof escrowId === 'string') {
        if (!jwt) {
            return res.status(500).json({ error: 'PINATA_JWT not configured' });
        }
        return fetchByEscrowId(escrowId, jwt, res);
    }

    return res.status(400).json({ error: 'Missing cid or escrowId parameter' });
}

async function fetchByCid(cid: string, jwt: string | undefined, res: VercelResponse) {
    try {
        // Use Pinata dedicated gateway with auth (fastest)
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (jwt) {
            headers['x-pinata-gateway-token'] = jwt;
        }

        const response = await fetch(`${PINATA_GATEWAY}/${cid}`, {
            headers,
            signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
            const data = await response.json();
            res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
            return res.status(200).json(data);
        }

        // Fallback to public gateways
        const fallbacks = [
            `https://ipfs.io/ipfs/${cid}`,
            `https://cloudflare-ipfs.com/ipfs/${cid}`,
        ];

        for (const gateway of fallbacks) {
            try {
                const resp = await fetch(gateway, {
                    headers: { Accept: 'application/json' },
                    signal: AbortSignal.timeout(8000),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
                    return res.status(200).json(data);
                }
            } catch {
                continue;
            }
        }

        return res.status(404).json({ error: 'Submission not found on IPFS' });
    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}

async function fetchByEscrowId(escrowId: string, jwt: string, res: VercelResponse) {
    try {
        const searchUrl = `https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=trustflow_submission_${escrowId}&pageLimit=1&sortBy=date_pinned&sortOrder=DESC`;

        const pinataRes = await fetch(searchUrl, {
            headers: { Authorization: `Bearer ${jwt}` },
            signal: AbortSignal.timeout(10000),
        });

        if (!pinataRes.ok) {
            return res.status(502).json({ error: 'Failed to search IPFS' });
        }

        const pinataData = await pinataRes.json();
        const rows = pinataData.rows || [];

        if (rows.length === 0) {
            return res.status(404).json({ error: 'No submission found' });
        }

        const latestCid = rows[0].ipfs_pin_hash;
        return fetchByCid(latestCid, jwt, res);
    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
