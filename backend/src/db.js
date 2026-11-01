import 'dotenv/config';
import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3307),
  database: process.env.DB_NAME || 'arandue',
  user: process.env.DB_USER || 'arandue',
  password: process.env.DB_PASSWORD || 'arandue',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
});
