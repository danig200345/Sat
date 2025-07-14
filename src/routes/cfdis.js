// file: routes/cfdis.js
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  solicitarDescarga,
  verificarEstado,
  descargarPaquete,
  getServiceFromCache
} from '../services/satClient.js';
import { pool } from '../db/database.js';

const router = Router();
// Todas las rutas en este archivo requieren autenticación con JWT.
router.use(authenticate);

/**
 * Endpoint para crear una nueva solicitud de descarga masiva.
 * El cliente debe especificar el 'serviceType' ('cfdi' o 'retenciones').
 */
router.post('/solicitar', async (req, res) => {
  try {
    // Se determina el tipo de servicio a utilizar. Por defecto, es 'cfdi'.
    const serviceType = req.body.serviceType || 'cfdi';
    const service = getServiceFromCache(req.user.rfc, serviceType);

    if (!service) {
      return res.status(401).json({ error: `La sesión para el servicio tipo '${serviceType}' ha expirado. Por favor, inicie sesión de nuevo.` });
    }

    const result = await solicitarDescarga(service, req.body);
    const { IdSolicitud, QueryParams } = result;

    // Guardamos la solicitud en nuestra base de datos, incluyendo el tipo de servicio.
    try {
      await pool.execute(
        `INSERT INTO download_requests (requester_rfc, service_type, request_id, query_params, request_status) VALUES (?, ?, ?, ?, ?)`,
        [req.user.rfc, serviceType, IdSolicitud, JSON.stringify(QueryParams), 'Aceptada']
      );
      console.log(`[DB] Solicitud ${IdSolicitud} (tipo: ${serviceType}) guardada para el RFC ${req.user.rfc}`);
    } catch (dbErr) {
      console.error('[DB ERROR] al guardar solicitud:', dbErr);
    }

    // Devolvemos una respuesta limpia al cliente.
    res.status(202).json({ success: true, IdSolicitud, CodEstatus: result.CodEstatus, Mensaje: result.Mensaje });
  } catch (err) {
    console.error('[ERROR SOLICITAR]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint para verificar el estado de una solicitud existente.
 * Consulta la BD para usar el servicio correcto.
 */
router.get('/estado/:idSolicitud', async (req, res) => {
  const { idSolicitud } = req.params;
  const rfc = req.user.rfc;

  try {
    // 1. Consultamos nuestra BD para saber cómo se creó esta solicitud.
    const [rows] = await pool.execute(
      `SELECT service_type FROM download_requests WHERE request_id = ? AND requester_rfc = ?`,
      [idSolicitud, rfc]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Solicitud no encontrada o no pertenece a este usuario.' });
    }

    const serviceType = rows[0].service_type;
    console.log(`Verificando ID ${idSolicitud}. La BD indica que se creó con el servicio: '${serviceType}'`);

    // 2. Obtenemos la instancia de servicio correcta de la caché.
    const service = getServiceFromCache(rfc, serviceType);
    if (!service) {
      return res.status(401).json({ error: `La sesión para el servicio tipo '${serviceType}' ha expirado.` });
    }

    // 3. Verificamos el estado usando el servicio correcto.
    const result = await verificarEstado(service, idSolicitud);

    // 4. Actualizamos el estado y los IDs de paquetes en nuestra BD.
    const { EstadoSolicitud, IdsPaquetes } = result;
    try {
      await pool.execute(
        `UPDATE download_requests SET request_status = ?, package_ids = ? WHERE request_id = ?`,
        [EstadoSolicitud, JSON.stringify(IdsPaquetes), idSolicitud]
      );
    } catch (dbErr) { console.error('[DB ERROR] al actualizar estado:', dbErr); }

    res.json({ success: true, ...result });

  } catch (err) {
    console.error(`[ERROR VERIFICAR] para ID ${idSolicitud}:`, err);
    res.status(500).json({ error: 'Fallo al verificar la solicitud.', details: err.message });
  }
});

/**
 * Endpoint para descargar un paquete de CFDI.
 * Consulta la BD para usar el servicio correcto.
 */
router.get('/descargar/:idPaquete', async (req, res) => {
  const { idPaquete } = req.params;
  const rfc = req.user.rfc;

  try {
    // 1. Buscamos a qué solicitud pertenece este paquete para saber el service_type.
    // La consulta busca el ID del paquete dentro del campo JSON 'package_ids'.
    const [rows] = await pool.execute(
      `SELECT service_type FROM download_requests WHERE JSON_CONTAINS(package_ids, JSON_QUOTE(?), '$') AND requester_rfc = ?`,
      [idPaquete, rfc]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Paquete no encontrado o no pertenece a este usuario.' });
    }

    const serviceType = rows[0].service_type;
    const service = getServiceFromCache(rfc, serviceType);
    if (!service) {
      return res.status(401).json({ error: `La sesión para el servicio tipo '${serviceType}' ha expirado.` });
    }

    // 2. Descargamos el paquete usando el servicio correcto.
    const { fileName, content } = await descargarPaquete(service, idPaquete);
    res.header('Content-Type', 'application/zip');
    res.header('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(content);

  } catch (err) {
    console.error(`[ERROR DESCARGAR] para Paquete ${idPaquete}:`, err);
    if (!res.headersSent) { res.status(500).json({ error: 'Fallo al descargar el paquete.', details: err.message }); }
  }
});

export default router;