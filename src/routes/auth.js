import { Router } from 'express';
import { login } from '../services/satClient.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const result = await login(req.files, req.body.password);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

export default router;