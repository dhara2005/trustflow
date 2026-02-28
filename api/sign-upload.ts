import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const jwt = process.env.PINATA_JWT;
    if (!jwt) {
        return res.status(500).json({ error: 'PINATA_JWT not configured' });
    }

    try {
        const { escrowId } = req.body;

        // Request a signed upload URL from Pinata
        const pinataRes = await fetch('https://api.pinata.cloud/v3/files/sign', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({
                date: Math.floor(Date.now() / 1000),
                expires: 300, // 5 minutes
            }),
        });

        if (!pinataRes.ok) {
            // Fallback: use the simpler approach with API key directly
            // Generate a temporary API key for the upload
            const keyRes = await fetch('https://api.pinata.cloud/users/generateApiKey', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify({
                    keyName: `upload_${escrowId}_${Date.now()}`,
                    maxUses: 2, // Allow 2 uses (file + unpin old if needed)
                    permissions: {
                        endpoints: {
                            pinning: {
                                pinFileToIPFS: true,
                            },
                        },
                    },
                }),
            });

            if (!keyRes.ok) {
                const err = await keyRes.text();
                console.error('Pinata key generation failed:', err);
                return res.status(502).json({ error: 'Failed to generate upload credentials' });
            }

            const keyData = await keyRes.json();
            return res.status(200).json({
                apiKey: keyData.pinata_api_key,
                apiSecret: keyData.pinata_api_secret,
                jwt: keyData.JWT,
            });
        }

        const signData = await pinataRes.json();
        return res.status(200).json({ signedUrl: signData.data });
    } catch (err: any) {
        console.error('Sign-upload error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
