import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateBrandingSettingsDto } from './dto/update-branding-settings.dto';
import { SettingsService } from './settings.service';
import { UpdateCompanyContactDto } from './dto/update-company-contact.dto';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('company-contact')
  @ApiOperation({ summary: 'Thông tin liên hệ công ty hiển thị công khai' })
  @ApiOkResponse({
    description: 'Số điện thoại, email, mã số thuế và địa chỉ song ngữ',
  })
  getCompanyContact() {
    return this.settingsService.getCompanyContact();
  }

  @Patch('company-contact')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cập nhật thông tin liên hệ công ty' })
  @ApiOkResponse({ description: 'Đã lưu thông tin liên hệ' })
  @ApiForbiddenResponse({ description: 'Chỉ quản trị viên được cập nhật' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  updateCompanyContact(@Body() dto: UpdateCompanyContactDto) {
    return this.settingsService.updateCompanyContact(dto);
  }

  @Get('branding')
  getBranding() {
    return this.settingsService.getBranding();
  }

  @Patch('branding')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  updateBranding(@Body() dto: UpdateBrandingSettingsDto) {
    return this.settingsService.updateBranding(dto);
  }
}
