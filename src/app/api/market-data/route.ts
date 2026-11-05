import { NextResponse } from "next/server";
import { getMarketData } from "@/services/utils";

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getMarketData());
}
