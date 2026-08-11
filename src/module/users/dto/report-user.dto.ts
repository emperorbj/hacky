import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReportUserDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
