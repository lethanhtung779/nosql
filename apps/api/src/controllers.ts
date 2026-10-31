import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsMongoId,
  IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, Min, MinLength
} from 'class-validator';
import { SpaService } from './spa.service';
import { Roles, RolesGuard } from './roles';
import { RedisService } from './redis.service';

class HoldDto {
  @IsMongoId() branch_id!: string;
  @IsMongoId() staff_id!: string;
  @IsArray() @ArrayMinSize(1) @IsMongoId({ each: true }) service_ids!: string[];
  @IsDateString() start_time!: string;
}
class BookDto extends HoldDto {
  @IsUUID() hold_token!: string;
  @IsOptional() @IsString() note?: string;
}
class StatusDto { @IsIn(['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) status!: string; }
class UserStatusDto { @IsIn(['ACTIVE', 'INACTIVE']) status!: string; }
class ReviewDto {
  @IsMongoId() appointment_id!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() comment?: string;
}
class BranchDto {
  @IsNotEmpty() name!: string;
  @IsNotEmpty() address!: string;
  @IsOptional() @IsString() phone?: string;
  @IsNumber({}, { each: true }) coordinates!: number[];
  @IsString() open!: string;
  @IsString() close!: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}
class BranchUpdateDto {
  @IsOptional() @IsNotEmpty() name?: string;
  @IsOptional() @IsNotEmpty() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsNumber({}, { each: true }) coordinates?: number[];
  @IsOptional() @IsString() open?: string;
  @IsOptional() @IsString() close?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}
class ServiceDto {
  @IsNotEmpty() name!: string;
  @IsNotEmpty() category!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(0) price!: number;
  @IsInt() @Min(5) duration_minutes!: number;
  @IsArray() @ArrayMinSize(1) @IsMongoId({ each: true }) branch_ids!: string[];
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}
class ServiceUpdateDto {
  @IsOptional() @IsNotEmpty() name?: string;
  @IsOptional() @IsNotEmpty() category?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsInt() @Min(5) duration_minutes?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsMongoId({ each: true }) branch_ids?: string[];
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}
class StaffDto {
  @IsNotEmpty() name!: string;
  @IsNotEmpty() phone!: string;
  @MinLength(6) password!: string;
  @IsMongoId() branch_id!: string;
  @IsNotEmpty() specialty!: string;
}
class StaffUpdateDto {
  @IsOptional() @IsNotEmpty() name?: string;
  @IsOptional() @IsNotEmpty() phone?: string;
  @IsOptional() @MinLength(6) password?: string;
  @IsOptional() @IsMongoId() branch_id?: string;
  @IsOptional() @IsNotEmpty() specialty?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}

@Controller('health')
export class HealthController {
  constructor(private redis: RedisService) {}
  @Get() async health() {
    return {
      status: 'ok', framework: 'NestJS',
      databases: { mongodb: 'connected', redis: (await this.redis.ping()) === 'PONG' ? 'connected' : 'error' },
      time: new Date()
    };
  }
}

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private spa: SpaService) {}
  @Get('branches') branches(@Query('longitude') lng?: string, @Query('latitude') lat?: string) {
    return this.spa.listBranches(Number(lng), Number(lat));
  }
  @Get('services') services(@Query('branch_id') id?: string) { return this.spa.listServices(id); }
  @Get('staff') staff(@Query('branch_id') id?: string) { return this.spa.listStaff(id); }
}

@ApiTags('slot holds')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('CUSTOMER')
@Controller('slots')
export class SlotController {
  constructor(private spa: SpaService) {}
  @Post('hold') hold(@Body() dto: HoldDto, @Req() req: any) { return this.spa.holdSlot(dto, req.user.sub); }
  @Get(':token') get(@Param('token') token: string, @Req() req: any) { return this.spa.getHold(token, req.user.sub); }
  @Delete(':token') release(@Param('token') token: string, @Req() req: any) { return this.spa.releaseHold(token, req.user.sub); }
}

@ApiTags('appointments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('appointments')
export class AppointmentController {
  constructor(private spa: SpaService) {}
  @Post() @Roles('CUSTOMER') book(@Body() dto: BookDto, @Req() req: any) { return this.spa.book(dto, req.user.sub); }
  @Get('mine') mine(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    return this.spa.listAppointments(req.user, from, to);
  }
  @Get(':id') get(@Param('id') id: string, @Req() req: any) { return this.spa.getAppointment(id, req.user); }
  @Patch(':id/status') @Roles('STAFF', 'ADMIN') status(@Param('id') id: string, @Body() dto: StatusDto, @Req() req: any) {
    return this.spa.setStatus(id, dto.status, req.user);
  }
  @Patch(':id/cancel') @Roles('CUSTOMER') cancel(@Param('id') id: string, @Req() req: any) {
    return this.spa.cancelAppointment(id, req.user.sub);
  }
}

@ApiTags('reviews')
@Controller('reviews')
export class ReviewController {
  constructor(private spa: SpaService) {}
  @Get() list(@Query('staff_id') id?: string) { return this.spa.listReviews(id); }
  @Post() @ApiBearerAuth() @UseGuards(AuthGuard('jwt'), RolesGuard) @Roles('CUSTOMER')
  create(@Body() dto: ReviewDto, @Req() req: any) { return this.spa.addReview(dto, req.user.sub); }
}

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('reports')
export class ReportController {
  constructor(private spa: SpaService) {}
  @Get('dashboard') dashboard() { return this.spa.report(); }
}

@ApiTags('administration')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private spa: SpaService) {}
  @Get('users') users() { return this.spa.listAdminUsers(); }
  @Post('branches') createBranch(@Body() dto: BranchDto) {
    return this.spa.createBranch({ name: dto.name, address: dto.address, phone: dto.phone, location: { type: 'Point', coordinates: dto.coordinates }, opening_hours: { open: dto.open, close: dto.close }, status: dto.status });
  }
  @Patch('branches/:id') updateBranch(@Param('id') id: string, @Body() dto: BranchUpdateDto) {
    const update: any = { ...dto };
    if (dto.coordinates) { update.location = { type: 'Point', coordinates: dto.coordinates }; delete update.coordinates; }
    if (dto.open || dto.close) { update.opening_hours = { open: dto.open, close: dto.close }; delete update.open; delete update.close; }
    return this.spa.updateBranch(id, update);
  }
  @Delete('branches/:id') deleteBranch(@Param('id') id: string) { return this.spa.archiveBranch(id); }
  @Post('services') createService(@Body() dto: ServiceDto) { return this.spa.createService(dto); }
  @Patch('services/:id') updateService(@Param('id') id: string, @Body() dto: ServiceUpdateDto) { return this.spa.updateService(id, dto); }
  @Delete('services/:id') deleteService(@Param('id') id: string) { return this.spa.archiveService(id); }
  @Post('staff') createStaff(@Body() dto: StaffDto) { return this.spa.createStaff(dto); }
  @Patch('staff/:id') updateStaff(@Param('id') id: string, @Body() dto: StaffUpdateDto) { return this.spa.updateStaff(id, dto); }
  @Delete('staff/:id') deleteStaff(@Param('id') id: string) { return this.spa.archiveStaff(id); }
  @Patch('users/:id/status') updateUserStatus(@Param('id') id: string, @Body() dto: UserStatusDto) {
    return this.spa.updateUserStatus(id, dto.status);
  }
}
