import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Lấy đúng domain public (quan trọng khi chạy trong Codespaces/proxy,
// vì request.url bên trong container thường trả về localhost)
function getBaseUrl(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // user_id
  const error = url.searchParams.get('error');
  const baseUrl = getBaseUrl(request);

  console.log('📥 Strava Callback nhận được:', { code: !!code, state, error });

  if (error || !code || !state) {
    console.error('❌ Lỗi callback từ Strava hoặc thiếu tham số:', error);
    return NextResponse.redirect(new URL('/?tab=profile&strava_error=access_denied', baseUrl));
  }

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID || '141757',
        client_secret: process.env.STRAVA_CLIENT_SECRET || '',
        code: code,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    console.log('🔄 Strava Token Response status:', tokenRes.status);

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('❌ Lỗi đổi Token Strava chi tiết:', tokenData);
      return NextResponse.redirect(new URL('/?tab=profile&strava_error=server_error&step=token', baseUrl));
    }

    const { access_token, refresh_token, expires_at, athlete } = tokenData;
    const stravaAthleteId = String(athlete?.id || '');
    const fullName = `${athlete?.firstname || ''} ${athlete?.lastname || ''}`.trim();

    console.log('✅ Đã lấy được Strava Athlete ID:', stravaAthleteId);

    // Kiểm tra xem ID Strava này đã liên kết với tài khoản khác chưa
    const { data: existingProfiles, error: fetchError } = await supabase
      .from('profiles')
      .select('id, strava_athlete_id')
      .eq('strava_athlete_id', stravaAthleteId)
      .maybeSingle();

    if (fetchError) {
      console.error('❌ Lỗi kiểm tra trùng lặp Strava Athlete ID:', fetchError);
      return NextResponse.redirect(new URL('/?tab=profile&strava_error=server_error&step=check', baseUrl));
    }

    if (existingProfiles && existingProfiles.id !== state) {
      console.error('❌ Strava ID đã liên kết với tài khoản khác:', existingProfiles.id);
      return NextResponse.redirect(new URL('/?tab=profile&strava_error=account_conflict', baseUrl));
    }

    const { data: updateData, error: dbError } = await supabase
      .from('profiles')
      .update({
        strava_connected: true,
        strava_access_token: access_token,
        strava_refresh_token: refresh_token,
        strava_token_expires_at: expires_at,
        strava_athlete_id: stravaAthleteId,
        ...(fullName ? { display_name: fullName } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', state)
      .select();

    if (dbError) {
      console.error('❌ Lỗi Supabase Database Update:', {
        message: dbError.message,
        code: dbError.code,
        details: dbError.details,
        hint: dbError.hint,
      });
      return NextResponse.redirect(new URL('/?tab=profile&strava_error=server_error&step=db', baseUrl));
    }

    console.log('🎉 Cập nhật profile thành công vào Database:', updateData);

    // Ghi log lịch sử kết nối
    await supabase.from('activity_history').insert({
      user_id: state,
      name: 'Liên kết tài khoản Strava thành công',
      description: `Đã kết nối với Strava ID: ${stravaAthleteId}`,
      start_date: new Date().toISOString(),
    }).select().maybeSingle();

    return NextResponse.redirect(new URL('/?tab=profile&strava_success=true', baseUrl));

  } catch (err: any) {
    console.error('❌ Ngoại lệ nghiêm trọng tại Strava Callback:', err.message || err);
    return NextResponse.redirect(new URL('/?tab=profile&strava_error=server_error&step=exception', baseUrl));
  }
}
