
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

import authRouter from './routes/auth.js';
import cfdiRouter from './routes/cfdis.js';

const upload = multer();
const app = express();
dotenv.config();

app.use(cors());
app.use(express.json());

// Ruta de autenticación que recibe archivos
app.use('/api/auth', upload.fields([
    { name: 'cer', maxCount: 1 },
    { name: 'key', maxCount: 1 }
]), authRouter);

// Rutas protegidas para la gestión de CFDI
app.use('/api/cfdi', cfdiRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));