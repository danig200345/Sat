// file: services/satClient.js
import {
    Fiel, Service, HttpsWebClient, FielRequestBuilder, ServiceEndpoints,
    QueryParameters, DateTimePeriod, RequestType, DownloadType, RfcMatch, DocumentType, DocumentStatus
} from '@nodecfdi/sat-ws-descarga-masiva';
import { pool } from '../db/database.js';
import forge from 'node-forge';

export const sessionCache = new Map();

/**
 * En el login, creamos y cacheamos DOS instancias de servicio:
 * una para CFDI regulares y otra para Retenciones.
 */
export async function createSession(files, password) {
    if (!files || !files.cer || !files.key) throw new Error('Debes proporcionar los archivos .cer y .key.');
    if (!password) throw new Error('Debes proporcionar la contraseña de la FIEL.');

    const cerBuffer = files.cer[0].buffer;
    const keyBuffer = files.key[0].buffer;

    const fiel = Fiel.create(cerBuffer.toString('binary'), keyBuffer.toString('binary'), password);
    if (!fiel.isValid()) throw new Error('La e.firma es inválida, ha expirado o la contraseña es incorrecta.');

    const rfc = fiel.getRfc();
    let certificateData = { rfc, serialNumber: null, razonSocial: rfc, validFrom: null, validTo: null };
    try {
        const pki = forge.pki;
        const cert = pki.certificateFromAsn1(forge.asn1.fromDer(cerBuffer.toString('binary')));
        certificateData.serialNumber = cert.serialNumber;
        certificateData.validFrom = cert.validity.notBefore;
        certificateData.validTo = cert.validity.notAfter;
        let potentialNames = [];
        for (const field of cert.subject.attributes) {
            const rfcRegex = /^[A-Z&Ñ]{3,4}[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[A0-9]$/;
            if (typeof field.value === 'string' && !rfcRegex.test(field.value.toUpperCase()) && field.value.toUpperCase() !== 'SAT') {
                potentialNames.push(field.value);
            }
        }
        if (potentialNames.length > 0) {
            certificateData.razonSocial = potentialNames.reduce((a, b) => a.length > b.length ? a : b);
        }
    } catch (e) {
        console.warn("Advertencia: No se pudieron extraer los detalles adicionales del certificado.", e.message);
    }

    try {
        await pool.execute(`INSERT INTO users (rfc, razon_social) VALUES (?, ?) ON DUPLICATE KEY UPDATE razon_social = VALUES(razon_social)`, [certificateData.rfc, certificateData.razonSocial]);
        if (certificateData.serialNumber && certificateData.validFrom && certificateData.validTo) {
            await pool.execute(`INSERT INTO fiels (user_rfc, serial_number, valid_from, valid_to) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE valid_from = VALUES(valid_from), valid_to = VALUES(valid_to), status = 'activa'`, [certificateData.rfc, certificateData.serialNumber, certificateData.validFrom, certificateData.validTo]);
        }
    } catch (err) {
        throw new Error('Error al registrar al usuario en la base de datos.');
    }

    const webClient = new HttpsWebClient();
    const requestBuilder = new FielRequestBuilder(fiel);

    // --- ARQUITECTURA DUAL ---
    console.log('[SAT Client] Creando instancia de servicio para CFDI Regulares...');
    const cfdiService = new Service(requestBuilder, webClient, undefined, ServiceEndpoints.cfdi());
    console.log('[SAT Client] Creando instancia de servicio para Retenciones...');
    const retencionesService = new Service(requestBuilder, webClient, undefined, ServiceEndpoints.retenciones());

    // Guardamos ambos servicios en la caché, identificados por un sufijo.
    sessionCache.set(`${rfc}_cfdi`, cfdiService);
    sessionCache.set(`${rfc}_retenciones`, retencionesService);

    return { rfc };
}

/**
 * Función de solicitud flexible que usa el servicio correcto
 * basándose en los parámetros del usuario.
 */
export async function solicitarDescarga(service, params) {
    const { fechaInicio, fechaFin, tipo, requestType, documentType, rfcEmisor, rfcReceptor } = params;
    let query = QueryParameters.create(DateTimePeriod.createFromValues(fechaInicio, fechaFin));

    if (tipo === 'Recibidos') { query = query.withDownloadType(new DownloadType('received')); }
    else { query = query.withDownloadType(new DownloadType('issued')); }

    if (requestType === 'CFDI') {
        query = query.withRequestType(new RequestType('xml'));
        query = query.withDocumentStatus(new DocumentStatus('active'));
    } else { query = query.withRequestType(new RequestType('metadata')); }

    if (documentType) {
        query = query.withDocumentType(new DocumentType(documentType.toLowerCase()));
    }

    const rfcContraparte = (tipo === 'Recibidos') ? rfcEmisor : rfcReceptor;
    if (rfcContraparte) { query = query.withRfcMatch(RfcMatch.create(rfcContraparte)); }

    const errors = query.validate();
    if (errors.length > 0) throw new Error(`Error de validación: ${errors.map(e => e.getMessage()).join(', ')}`);

    try {
        const result = await service.query(query);
        if (!result.getStatus().isAccepted()) throw new Error(`El SAT no aceptó la consulta: ${result.getStatus().getMessage()}`);
        return { IdSolicitud: result.getRequestId(), CodEstatus: result.getStatus().getCode(), Mensaje: result.getStatus().getMessage(), QueryParams: { ...params } };
    } catch (e) {
        if (e.message.includes('Se han agotado las solicitudes')) throw new Error('Límite de solicitudes del SAT alcanzado. Intente más tarde.');
        throw new Error(`Fallo al presentar la consulta: ${e.message}`);
    }
}

/**
 * Recupera la instancia del servicio de la caché basándose en el tipo.
 */
export function getServiceFromCache(rfc, serviceType = 'cfdi') {
    return sessionCache.get(`${rfc}_${serviceType}`);
}

export async function verificarEstado(service, idSolicitud) {
    const verify = await service.verify(idSolicitud);
    if (!verify.getStatus().isAccepted()) throw new Error(`Fallo al verificar la consulta ${idSolicitud}: ${verify.getStatus().getMessage()}`);
    const statusRequest = verify.getStatusRequest();
    let estadoTexto = 'Desconocido';
    if (statusRequest.isTypeOf('Accepted')) { estadoTexto = 'Aceptada'; }
    else if (statusRequest.isTypeOf('InProgress')) { estadoTexto = 'En proceso'; }
    else if (statusRequest.isTypeOf('Finished')) { estadoTexto = 'Finalizada'; }
    else if (statusRequest.isTypeOf('Failure')) { estadoTexto = 'Error'; }
    else if (statusRequest.isTypeOf('Rejected')) { estadoTexto = 'Rechazada'; }
    else if (statusRequest.isTypeOf('Expired')) { estadoTexto = 'Expirada'; }
    const codigoEstado = statusRequest.value.code;
    return { EstadoSolicitud: estadoTexto, CodigoEstado: codigoEstado, CodEstatus: verify.getStatus().getCode(), Mensaje: verify.getStatus().getMessage(), IdsPaquetes: verify.getPackageIds() };
}

export async function descargarPaquete(service, idPaquete) {
    const downloadResult = await service.download(idPaquete);
    if (!downloadResult.getStatus().isAccepted()) throw new Error(`El paquete ${idPaquete} no se ha podido descargar: ${downloadResult.getStatus().getMessage()}`);
    return { fileName: `paquete_${idPaquete}.zip`, content: Buffer.from(downloadResult.getPackageContent(), 'base64') };
}