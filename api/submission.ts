import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { cid } = req.query;

    if (!cid || typeof cid !== 'string') {
        return res.status(400).json({ error: 'Missing cid parameter' });
    }

    try {
        // Fetch from public IPFS gateway
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
                continue; // Try next gateway
            }
        }

        if (!data) {
            return res.status(404).json({ error: 'Submission not found on IPFS' });
        }

        // Cache for 1 hour (IPFS content is immutable)
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
        return res.status(200).json(data);
    } catch (err: any) {
        console.error('Fetch error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
