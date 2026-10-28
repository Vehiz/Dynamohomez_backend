import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { appEnv } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow base64 document payloads (verification uploads) to pass body parsing.
  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));

  app.enableCors({
    origin: appEnv.CORS_ORIGIN,
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const maxPortAttempts = 10;
  let runningPort = appEnv.PORT;

  for (let attempt = 0; attempt <= maxPortAttempts; attempt += 1) {
    const portToTry = appEnv.PORT + attempt;

    try {
      await app.listen(portToTry);
      runningPort = portToTry;
      break;
    } catch (error) {
      const listenError = error as NodeJS.ErrnoException;

      if (listenError.code === 'EADDRINUSE' && attempt < maxPortAttempts) {
        console.warn(`Port ${portToTry} is in use, trying ${portToTry + 1}...`);
        continue;
      }

      throw error;
    }
  }

  console.log(`Backend running on http://localhost:${runningPort}/api`);
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap backend', error);
  process.exit(1);
});
