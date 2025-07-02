import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  solicitarDescarga,
  verificarEstado,
  descargarPaquete,
  limpiarCredenciales,
  listarPendientes
} from '../services/satClient.js';

export const credencialesCache = new Map();
let pendientes = [];

const router = Router();
router.use(authenticate);

// POST /api/cfdi/solicitar
router.post('/solicitar', async (req, res) => {
  const { fechaInicio, fechaFin, tipo, rfcEmisor, rfcReceptor } = req.body;
  try {
    const { idSolicitud, CodEstatus, Mensaje } =
      await solicitarDescarga(req.token, req.creds, { fechaInicio, fechaFin, tipo, rfcEmisor, rfcReceptor });
    pendientes.push({ id: idSolicitud, token: req.token });
    res.json({ success: true, idSolicitud, CodEstatus, Mensaje });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cfdi/estado/:idSolicitud
router.get('/estado/:idSolicitud', async (req, res) => {
  try {
    const estado = await verificarEstado(req.token, req.creds, req.params.idSolicitud);
    if (estado.EstadoSolicitud === 3) pendientes = pendientes.filter(p => p.id !== req.params.idSolicitud);
    res.json(estado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cfdi/descargar/:idPaquete
router.get('/descargar/:idPaquete', async (req, res) => {
  try {
    await descargarPaquete(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cfdi/pendientes
router.get('/pendientes', (_, res) => {
  res.json(listarPendientes(pendientes));
});

// POST /api/cfdi/limpiar
router.post('/limpiar', (_, res) => {
  limpiarCredenciales(req.token);
  pendientes = [];
  res.json({ success: true });
});

export function verificarPendientes() {
  pendientes.forEach(async p => {
    try {
      const estado = await verificarEstado(p.token, credencialesCache.get(p.token), p.id);
      if (estado.EstadoSolicitud === 3) pendientes = pendientes.filter(x => x.id !== p.id);
    } catch { };
  });
}

export { router as cfdiRouter };