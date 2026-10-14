import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse } from '../../common/validate';
import {
  type Closing,
  type DailyReport,
  type DoctorReportRow,
  ReportsService,
  closeDaySchema,
  dailyQuerySchema,
  listClosingsSchema,
  rangeQuerySchema,
} from './reports.service';

@Controller()
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Roles('owner', 'receptionist')
  @Get('reports/daily')
  daily(@Ctx() ctx: ReqCtx, @Query() query: unknown): Promise<DailyReport> {
    return this.reports.daily(ctx, parse(dailyQuerySchema, query).date);
  }

  @Roles('owner')
  @Get('reports/doctors')
  byDoctor(@Ctx() ctx: ReqCtx, @Query() query: unknown): Promise<DoctorReportRow[]> {
    const range = parse(rangeQuerySchema, query);
    return this.reports.byDoctor(ctx, range.from, range.to);
  }

  @Roles('owner', 'receptionist')
  @Post('closings')
  closeDay(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<Closing> {
    return this.reports.closeDay(ctx, parse(closeDaySchema, body));
  }

  @Roles('owner', 'receptionist')
  @Get('closings')
  listClosings(@Ctx() ctx: ReqCtx, @Query() query: unknown): Promise<Closing[]> {
    const page = parse(listClosingsSchema, query);
    return this.reports.listClosings(ctx, page.limit, page.offset);
  }
}
