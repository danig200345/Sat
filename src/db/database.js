import { createPool } from 'mysql2/promise'
import dotenv from 'dotenv'
dotenv.config()

export const pool = createPool({
    host: process.env.HOST,
    database: process.env.DATABASE,
    user: process.env.USER,
    password: process.env.PASSWORD,
    connectionLimit: process.env.CONNECTION_LIMIT,
    waitForConnections: true,
    queueLimit: process.env.QUEUE_LIMIT
})

pool.getConnection()
    .then(connection => {
        console.log('✅ Conexión a la base de datos MySQL establecida exitosamente.');
        connection.release(); // Importante devolver la conexión al pool
    })
    .catch(err => {
        console.error('❌ ERROR: No se pudo conectar a la base de datos MySQL.');
        console.error('Detalles:', err.message);
        process.exit(1); // Detiene la aplicación si no hay conexión a la BD
    });



