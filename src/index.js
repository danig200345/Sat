import 'dotenv/config.js';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import multer from 'multer';
import cron from 'node-cron';

import authRouter from './routes/auth.js';
import { cfdiRouter, verificarPendientes } from './routes/cfdis.js';

const upload = multer();
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Rutas de autenticación (incluye upload de cer y key)
app.use('/api/auth', upload.fields([
    { name: 'cer', maxCount: 1 },
    { name: 'key', maxCount: 1 }
]), authRouter);

// Rutas CFDI (solicitar, estado, descargar, limpiar cache)
app.use('/api/cfdi', cfdiRouter);

// Cron: cada 5 minutos verifica pendientes
cron.schedule('*/5 * * * *', verificarPendientes);

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));


