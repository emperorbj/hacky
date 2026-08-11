import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/(?=.*[a-zA-Z])(?=.*[0-9])/, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;
}
