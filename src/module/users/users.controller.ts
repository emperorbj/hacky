import {
  Body,
  Controller,
  Get,
  Patch,
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
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Patch('me/resume')
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
}
