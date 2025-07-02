
import {
    Fiel,
    Service,
    QueryParameters,
    RequestType,
    DownloadType,
    HttpsWebClient,
    FielRequestBuilder,
    DateTimePeriod,
    RfcMatch
} from '@nodecfdi/sat-ws-descarga-masiva';

import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();



export const credencialesCache = new Map();

export async function login(files, password) {
    if (!files.cer || !files.key) {
        throw new Error('Debes proporcionar los archivos .cer y .key.');
    }
    console.log("[LOG] Iniciando proceso con '@nodecfdi/sat-ws-descarga-masiva'...");


    const fiel = Fiel.create(
        files.cer[0].buffer.toString('binary'),
        files.key[0].buffer.toString('binary'),
        password
    );

    // 2. Validar la e.firma
    if (!fiel.isValid()) {
        throw new Error('La e.firma es inválida o la contraseña es incorrecta.');
    }
    const rfc = fiel.getRfc();
    console.log(`[LOG] RFC extraído: ${rfc}`);

    // 3. Crear los componentes del servicio
    const webClient = new HttpsWebClient();
    const requestBuilder = new FielRequestBuilder(fiel);
    const service = new Service(requestBuilder, webClient);

    // Guardamos la instancia de 'service' en caché usando el RFC como clave
    credencialesCache.set(rfc, service);

    console.log('[LOG] Instancia de servicio creada exitosamente.');
    return { token: rfc, rfc: rfc };
}

export async function solicitarDescarga(token, params) {
    const service = credencialesCache.get(token);
    if (!service) {
        throw new Error('Sesión no encontrada. Por favor, autentíquese de nuevo.');
    }

    const { fechaInicio, fechaFin, tipo, requestType, rfcEmisor, rfcReceptor } = params;

    // Crear parámetros de consulta con el periodo de fechas
    // El formato esperado es 'YYYY-MM-DD HH:mm:ss'
    const period = DateTimePeriod.createFromValues(fechaInicio, fechaFin);
    const parameters = QueryParameters.create(period);

    // Definir tipo de descarga (Emitidos o Recibidos)
    if (tipo === 'Recibidos') {
        parameters.setDownloadType(DownloadType.received());
        // En recibidos, se puede filtrar por el RFC del emisor
        if (rfcEmisor) {
            parameters.setRfcMatch(RfcMatch.create(rfcEmisor));
        }
    } else { // 'Emitidos'
        parameters.setDownloadType(DownloadType.issued());
        // En emitidos, se puede filtrar por el RFC del receptor
        if (rfcReceptor) {
            parameters.setRfcMatch(RfcMatch.create(rfcReceptor));
        }
    }

    // Definir tipo de solicitud (Metadata o XML de los CFDI)
    if (requestType === 'CFDI') {
        parameters.setRequestType(RequestType.xml());
    } else { // 'Metadata' por defecto
        parameters.setRequestType(RequestType.metadata());
    }

    console.log('[LOG] Solicitando descarga con parámetros:', JSON.stringify(parameters.jsonSerialize(), null, 2));
    const result = await service.query(parameters);

    if (!result.getStatus().isAccepted()) {
        throw new Error(`Fallo al presentar la consulta: ${result.getStatus().getMessage()}`);
    }

    console.log(`[LOG] Solicitud de descarga enviada. ID: ${result.getRequestId()}, Encontrados: ${result.getCount()}`);
    return {
        IdSolicitud: result.getRequestId(),
        CodEstatus: result.getStatus().getCode(),
        Mensaje: result.getStatus().getMessage()
    };
}

export async function verificarEstado(token, idSolicitud) {
    const service = credencialesCache.get(token);
    if (!service) {
        throw new Error('Sesión no encontrada.');
    }

    console.log(`[LOG] Verificando estado de la solicitud: ${idSolicitud}`);
    const result = await service.verify(idSolicitud);

    if (!result.getStatus().isAccepted()) {
        throw new Error(`Fallo al verificar la consulta ${idSolicitud}: ${result.getStatus().getMessage()}`);
    }

    const statusRequest = result.getStatusRequest();

    let response = {
        EstadoSolicitud: statusRequest.getCode(),
        CodEstatus: result.getStatus().getCode(),
        Mensaje: `[${statusRequest.getMessage()}] ${result.getStatus().getMessage()}`,
        IdsPaquetes: result.getPackageIds() // Devuelve un array vacío si no está lista
    };

    // Si la solicitud ya terminó, podemos obtener los paquetes directamente
    if (statusRequest.isFinished()) {
        console.log(`[LOG] Solicitud ${idSolicitud} finalizada. Obteniendo paquetes...`);
        const packages = await service.packages(idSolicitud);
        response.IdsPaquetes = packages.getPackagesIds();
        console.log(`[LOG] Paquetes encontrados: ${response.IdsPaquetes.join(', ')}`);
    } else {
        console.log(`[LOG] Estado de la solicitud ${idSolicitud}: ${statusRequest.getMessage()}`);
    }

    return response;
}

export async function descargarPaquete(token, idPaquete) {
    const service = credencialesCache.get(token);
    if (!service) {
        throw new Error('Sesión no encontrada.');
    }

    console.log(`[LOG] Descargando paquete: ${idPaquete}`);
    const downloadResult = await service.download(idPaquete);

    if (!downloadResult.getStatus().isAccepted()) {
        throw new Error(`El paquete ${idPaquete} no se ha podido descargar: ${downloadResult.getStatus().getMessage()}`);
    }

    return Buffer.from(downloadResult.getPackageContent(), 'base64');
}

export function limpiarCredenciales(token) {
    credencialesCache.delete(token);
    console.log(`[LOG] Sesión para RFC ${token} eliminada del caché.`);
}

export function listarPendientes(listaDeSolicitudes) {
    if (!Array.isArray(listaDeSolicitudes)) {
        console.warn("[WARN] listarPendientes recibió un valor que no es un array:", listaDeSolicitudes);
        return [];
    }
    return listaDeSolicitudes.map(solicitud => ({
        id: solicitud.id
    }));
}