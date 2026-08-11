import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface.js';
import { FileValidationPipe } from '../../common/pipes/file-validation.pipe.js';
import { ReportUserDto } from './dto/report-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Patch('me/resume')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  uploadResume(
    @CurrentUser() user: JwtPayload,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ['application/pdf'],
        maxSizeBytes: MAX_FILE_SIZE_BYTES,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.usersService.uploadResume(user.sub, file);
  }

  @Patch('me/photo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: JwtPayload,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxSizeBytes: MAX_FILE_SIZE_BYTES,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.usersService.uploadPhoto(user.sub, file);
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  reportUser(
    @CurrentUser() user: JwtPayload,
    @Param('id') targetUserId: string,
    @Body() dto: ReportUserDto,
  ) {
    return this.usersService.reportUser(user.sub, targetUserId, dto);
  }

  @Get(':id')
  getPublicProfile(@Param('id') userId: string) {
    return this.usersService.getPublicProfile(userId);
  }
}
