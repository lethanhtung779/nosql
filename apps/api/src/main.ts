import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
async function bootstrap(){const app=await NestFactory.create(AppModule);app.setGlobalPrefix('api');app.enableCors({origin:process.env.WEB_ORIGIN||'http://localhost:3000'});app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true}));const cfg=new DocumentBuilder().setTitle('NexaSalon API').setDescription('API nền tảng quản lý và đặt lịch Spa & Salon sử dụng MongoDB và Redis').setVersion('2.0').addBearerAuth().build();SwaggerModule.setup('api/docs',app,SwaggerModule.createDocument(app,cfg));await app.listen(process.env.API_PORT||3001);console.log('NexaSalon API: http://localhost:3001/api');} bootstrap();
