const app = require('./app');
const config = require('./config');
const { connectDb, closeDb } = require('./db');

async function main() {
  await connectDb();
  const server = app.listen(config.port, () => console.log(`Spa Salon đang chạy tại http://localhost:${config.port}`));
  const shutdown = () => server.close(() => closeDb().finally(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Không thể khởi động:', error);
  process.exit(1);
});
