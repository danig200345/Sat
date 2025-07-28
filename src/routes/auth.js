
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { createSession } from '../services/satClient.js';

const router = Router();

router.post('/login', async (req, res) => {
    try {
        const { rfc } = await createSession(req.files, req.body.password);
        const payload = { rfc };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
        console.log(`[JWT] Token creado para el RFC ${rfc}`);
        res.json({ success: true, token });
    } catch (error) {
        console.error('[ERROR LOGIN]', error);
        res.status(401).json({ error: error.message });
    }
});

export default router;