import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/error.filter';

/** Mipangilio ya pamoja ya app (inatumika pia kwenye majaribio ya e2e). */
export function configureApp(app: NestExpressApplication) {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  // Dashboard ya admin ya web itahitaji CORS; kwenye production weka origin maalum.
  app.enableCors();
}

async function bootstrap() {
  // rawBody inahitajika kuhakiki saini ya webhook ya malipo.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  // Dashboard ya admin (ukurasa wa wavuti): http://localhost:3000/admin
  app.useStaticAssets(join(process.cwd(), 'public', 'admin'), {
    prefix: '/admin',
    setHeaders: (res) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
    },
  });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend inaendesha: http://localhost:${port}/api/v1`);
}

if (require.main === module) {
  bootstrap();
}
