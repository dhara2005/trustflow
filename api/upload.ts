import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const jwt = process.env.PINATA_JWT;
    if (!jwt) {
        return res.status(500).json({ error: 'PINATA_JWT not configured' });
    }

    try {
        const { text, files, escrowId, submitter } = req.body;

        if (!text && (!files || files.length === 0)) {
            return res.status(400).json({ error: 'No submission content provided' });
        }

        // Build the submission object
        const submission = {
            escrowId,
            submitter,
            text: text || '',
            files: files || [], // Array of { name, dataUrl, type }
            submittedAt: new Date().toISOString(),
        };

        // Upload JSON to Pinata
        const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({
                pinataContent: submission,
                pinataMetadata: {
                    name: `trustflow_submission_${escrowId}`,
                    keyvalues: {
                        escrowId: escrowId.toString(),
                        submitter: submitter || '',
                        app: 'trustflow',
                    },
                },
            }),
        });

        if (!pinataRes.ok) {
            const err = await pinataRes.text();
            console.error('Pinata upload failed:', err);
            return res.status(502).json({ error: 'IPFS upload failed' });
        }

        const pinataData = await pinataRes.json();
        return res.status(200).json({
            cid: pinataData.IpfsHash,
            timestamp: submission.submittedAt,
        });
    } catch (err: any) {
        console.error('Upload error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
