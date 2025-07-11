// file: routes/cfdis.js
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  solicitarDescarga,
  verificarEstado,
  descargarPaquete,
  getServiceFromCache // Importamos la función para obtener el servicio
} from '../services/satClient.js';
import { pool } from '../db/database.js';

const router = Router();
router.use(authenticate);

// Middleware para cargar el servicio correcto en la petición
const loadService = (req, res, next) => {
  // El cliente debe especificar qué servicio usar, por defecto es 'cfdi'
  const serviceType = req.body.serviceType || req.query.serviceType || 'cfdi';
  const service = getServiceFromCache(req.user.rfc, serviceType);

  if (!service) {
    return res.status(401).json({ error: `La sesión para el servicio tipo '${serviceType}' ha expirado o no existe.` });
  }
  req.service = service; // Adjuntamos el servicio a la petición
  next();
};

router.post('/solicitar', loadService, async (req, res) => {
  try {
    const result = await solicitarDescarga(req.service, req.body);
    const { IdSolicitud, QueryParams } = result;
    const requesterRfc = req.user.rfc;
    try {
      await pool.execute(
        `INSERT INTO download_requests (requester_rfc, request_id, query_params, request_status) VALUES (?, ?, ?, ?)`,
        [requesterRfc, IdSolicitud, JSON.stringify(QueryParams), 'Aceptada']
      );
    } catch (dbErr) { console.error('[DB ERROR] al guardar solicitud:', dbErr); }
    res.status(202).json({ success: true, IdSolicitud, CodEstatus: result.CodEstatus, Mensaje: result.Mensaje });
  } catch (err) {
    console.error('[ERROR SOLICITAR]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/estado/:idSolicitud', async (req, res) => {
  // Para verificar, necesitamos saber con qué servicio se creó la solicitud.
  // Lo ideal sería guardarlo en la BD, pero por simplicidad, probaremos ambos.
  const rfc = req.user.rfc;
  const serviceCfdi = getServiceFromCache(rfc, 'cfdi');
  const serviceRetenciones = getServiceFromCache(rfc, 'retenciones');

  if (!serviceCfdi || !serviceRetenciones) {
    return res.status(401).json({ error: 'La sesión del servicio ha expirado. Por favor, inicie sesión de nuevo.' });
  }

  try {
    let result;
    try {
      // Intentamos verificar con el servicio de CFDI regulares primero
      result = await verificarEstado(serviceCfdi, req.params.idSolicitud);
    } catch (e) {
      // Si falla (ej. "Solicitud no encontrada"), intentamos con el de retenciones
      console.warn(`Verificación con servicio CFDI falló, reintentando con Retenciones...`);
      result = await verificarEstado(serviceRetenciones, req.params.idSolicitud);
    }

    const { EstadoSolicitud, IdsPaquetes } = result;
    try {
      await pool.execute(
        `UPDATE download_requests SET request_status = ?, package_ids = ? WHERE request_id = ?`,
        [EstadoSolicitud, JSON.stringify(IdsPaquetes), req.params.idSolicitud]
      );
    } catch (dbErr) { console.error('[DB ERROR] al actualizar estado:', dbErr); }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[ERROR VERIFICAR]', err);
    res.status(500).json({ error: err.message });
  }
});


router.get('/descargar/:idPaquete', async (req, res) => {
  // Similar a verificar, la descarga podría ser de cualquiera de los dos servicios.
  const rfc = req.user.rfc;
  const serviceCfdi = getServiceFromCache(rfc, 'cfdi');
  const serviceRetenciones = getServiceFromCache(rfc, 'retenciones');

  if (!serviceCfdi || !serviceRetenciones) {
    return res.status(401).json({ error: 'La sesión del servicio ha expirado. Por favor, inicie sesión de nuevo.' });
  }

  try {
    let download;
    try {
      download = await descargarPaquete(serviceCfdi, req.params.idPaquete);
    } catch (e) {
      console.warn(`Descarga con servicio CFDI falló, reintentando con Retenciones...`);
      download = await descargarPaquete(serviceRetenciones, req.params.idPaquete);
    }

    const { fileName, content } = download;
    res.header('Content-Type', 'application/zip');
    res.header('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(content);
  } catch (err) {
    console.error('[ERROR DESCARGAR]', err);
    if (!res.headersSent) { res.status(500).json({ error: err.message }); }
  }
});

export default router;