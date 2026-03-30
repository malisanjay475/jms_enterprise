import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SyncAction } from '@prisma/client';

export class SyncRecordDto {
  @IsUUID()
  sync_id: string;

  @IsString()
  @IsNotEmpty()
  table_name: string;

  @IsString()
  @IsNotEmpty()
  record_id: string;

  @IsEnum(SyncAction)
  action: SyncAction;

  @IsNotEmpty()
  row_data: any; // JSON payload

  @IsInt()
  version: number; // MVCC Versioning

  @IsString()
  @IsOptional()
  timestamp?: string;
}

export class SyncBatchDto {
  @IsInt()
  factory_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncRecordDto)
  payload: SyncRecordDto[];
}
