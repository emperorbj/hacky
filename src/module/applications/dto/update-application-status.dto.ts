import { IsEnum, IsNotEmpty, IsUrl, ValidateIf } from 'class-validator';
import { ApplicationStatus } from '../../../../generated/prisma/enums.js';

export class UpdateApplicationStatusDto {
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus;

  @ValidateIf(
    (dto: UpdateApplicationStatusDto) =>
      dto.status === ApplicationStatus.INTERVIEW,
  )
  @IsNotEmpty({
    message: 'meetingLink is required when moving an application to INTERVIEW',
  })
  @IsUrl()
  meetingLink?: string;
}
