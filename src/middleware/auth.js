import { credencialesCache } from '../routes/cfdis.js';

export function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token Bearer requerido' });
    }
    const token = auth.substring(7).trim();
    if (!credencialesCache.has(token)) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    req.token = token;
    req.creds = credencialesCache.get(token);
    next();
}
