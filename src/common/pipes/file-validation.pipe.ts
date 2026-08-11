import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';

interface FileValidationOptions {
  allowedMimeTypes: string[];
  maxSizeBytes: number;
}

@Injectable()
export class FileValidationPipe implements PipeTransform<Express.Multer.File> {
  constructor(private readonly options: FileValidationOptions) {}

  async transform(file: Express.Multer.File): Promise<Express.Multer.File> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (file.size > this.options.maxSizeBytes) {
      const maxMb = Math.floor(this.options.maxSizeBytes / (1024 * 1024));
      throw new BadRequestException(`File too large. Max size is ${maxMb}MB`);
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !this.options.allowedMimeTypes.includes(detected.mime)) {
      throw new BadRequestException(
        `Invalid file type. Allowed types: ${this.options.allowedMimeTypes.join(', ')}`,
      );
    }

    return file;
  }
}
