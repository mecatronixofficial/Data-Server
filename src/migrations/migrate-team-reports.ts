import 'reflect-metadata';
import dotenv from 'dotenv';
import { resolve } from 'path';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
dotenv.config({
  path: process.env.ENV_FILE || resolve(process.cwd(), '.env.production'),
});

async function run() {
  const [{ NestFactory }, { AppModule }, { EntriesService }] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../entries/entries.service'),
  ]);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const result = await app.get(EntriesService).migrateTeamReports();
    console.log(`Team report migration: ${result.status}`);
  } finally {
    await Promise.race([
      app.close(),
      new Promise<void>((resolveClose) => setTimeout(resolveClose, 5000)),
    ]);
  }
}

run().then(
  () => process.exit(0),
  (error) => {
    console.error('Team report migration failed', error);
    process.exit(1);
  },
);
