import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import {
  EmploymentType,
  ExperienceLevel,
  WorkMode,
} from '../../../../generated/prisma/enums.js';

export class CreateJobDto {
  @IsString()
  @MinLength(3)
  title!: string;

  @IsString()
  @MinLength(20)
  description!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsEnum(WorkMode)
  workMode!: WorkMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryRangeMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryRangeMax?: number;

  @IsEnum(ExperienceLevel)
  experienceLevel!: ExperienceLevel;

  @IsArray()
  @IsString({ each: true })
  skills!: string[];

  @IsOptional()
  @IsDateString()
  applicationDeadline?: string;
}
